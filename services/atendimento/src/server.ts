import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { basename } from 'node:path';
import { buildDeliveryMedia, type DeliveryMedia } from './cards.js';
import { getItem } from './catalog.js';
import { deliverReading, handleLead, markDelivered, type AgentDeps } from './agent.js';
import type { Config } from './config.js';
import type { EvolutionClient } from './evolution/client.js';
import { parseWebhook } from './evolution/parse.js';
import { createDebouncer } from './debounce.js';
import { decide } from './filter.js';
import { createRateLimiter, thinkDelayMs, typingDelayMs } from './humanize.js';
import type { LlmClient } from './llm/nim.js';
import { confirmPayment } from './payments.js';
import type { PixProvider } from './pix/provider.js';
import type { AdSpendRecord, Store } from './store.js';
import type { InboundMessage } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Resolve quando todo o processamento em segundo plano dos webhooks terminou (usado em testes e no desligamento). */
    settled(): Promise<void>;
  }
}

export type ServerDeps = {
  config: Config;
  store: Store;
  llm: LlmClient;
  pix: PixProvider;
  evolution: EvolutionClient;
  now: () => number;
  /** Espera de verdade em produção; nos testes é simulada. */
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  /** Pasta assets/ (shuffling.jpg e cards/NN.jpg). Sem ela, a entrega é só texto. */
  assetsDir?: string;
  notifyOwner: (text: string) => void | Promise<void>;
};

// A Evolution devolve no webhook, como "fromMe", as mensagens que o bot envia pela API.
// O eco é reconhecido pelo id da mensagem enviada (marcado como visto). Plano B, quando a
// Evolution não devolve o id: janela de tempo depois do envio.
const BOT_ECHO_WINDOW_MS = 5000;
// Mensagens mais velhas que isto (ex.: histórico após reconexão) não são respondidas.
const MAX_MESSAGE_AGE_MS = 10 * 60_000;
const NOTICES_LIMIT = 50;
// Janela de 24 h da API oficial do WhatsApp, respeitada por conta própria (pronta para uma troca futura).
const WINDOW_24H_MS = 24 * 3_600_000;
const RATE_WINDOW_MS = 60_000;

// Só conversas individuais recebem mensagem. Grupos, status, canais etc. nunca.
function isIndividualChat(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// "Hoje" no horário de Brasília (UTC-3, sem horário de verão), porque o container roda em UTC.
const BRT_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
function startOfDayBrt(nowMs: number): number {
  return Math.floor((nowMs - BRT_OFFSET_MS) / DAY_MS) * DAY_MS + BRT_OFFSET_MS;
}
const PANEL_NOTICES = 5;
const AD_SPEND_FRESH_MS = 60 * 60_000;

type AdSpendStatus = 'disabled' | 'ok' | 'stale' | 'error';

// Estado do gasto em anúncios para o painel: nunca mostra dado velho como se fosse atual.
function adSpendView(record: AdSpendRecord | null, metaEnabled: boolean, nowMs: number) {
  const empty = { totalCents: null, todayCents: null, currency: null, fetchedAtMs: null, errorKind: null };
  if (!record) return { status: (metaEnabled ? 'stale' : 'disabled') as AdSpendStatus, ...empty };
  const status: AdSpendStatus = record.errorKind
    ? 'error'
    : record.fetchedAtMs === null || nowMs - record.fetchedAtMs > AD_SPEND_FRESH_MS
      ? 'stale'
      : 'ok';
  return { status, ...record };
}
const PANEL_FILE = new URL('../public/painel.html', import.meta.url);

const pixBodySchema = z.object({ chargeId: z.string().min(1) });

function sameToken(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// Várias mensagens seguidas viram uma só (textos em linhas; áudios e figuras sem texto são ignorados
// quando há texto). Os demais campos vêm da última mensagem; a marca de anúncio, da primeira que tiver.
function mergeBatch(batch: InboundMessage[]): InboundMessage {
  const last = batch[batch.length - 1]!;
  const texts = batch.map((m) => m.text?.trim() ?? '').filter((t) => t.length > 0);
  return {
    ...last,
    text: texts.length > 0 ? texts.join('\n') : null,
    adReferral: batch.find((m) => m.adReferral !== null)?.adReferral ?? null,
  };
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const blocklist = new Set(deps.config.blocklist);
  const agentDeps: AgentDeps = {
    llm: deps.llm,
    store: deps.store,
    pix: deps.pix,
    now: deps.now,
    ...(deps.rng ? { rng: deps.rng } : {}),
  };

  const debouncer = createDebouncer<InboundMessage>({
    waitMs: deps.config.messageDebounceSeconds * 1000,
    onFlush: (jid, batch) => enqueue(jid, () => processBatch(jid, batch)),
  });
  const queues = new Map<string, Promise<void>>();
  const pending = new Set<Promise<void>>();
  let processing = 0;
  let panelHtml: string | null = null;
  const botActiveUntil = new Map<string, number>();
  const sending = new Set<string>();
  const limiter = createRateLimiter({
    perChat: deps.config.maxMsgsPerMinuteChat,
    global: deps.config.maxMsgsPerMinute,
    windowMs: RATE_WINDOW_MS,
    now: deps.now,
    sleep: deps.sleep ?? realSleep,
  });

  async function safeNotify(text: string): Promise<void> {
    try {
      deps.store.addNotice(text, deps.now());
    } catch {
      // Avisar o dono nunca pode derrubar o processamento.
    }
    try {
      await deps.notifyOwner(text);
    } catch {
      // idem
    }
  }

  // Um chat por vez: mensagens do mesmo jid são processadas em ordem.
  function enqueue(key: string, task: () => Promise<void>): void {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        processing += 1;
        try {
          await task();
        } finally {
          processing -= 1;
        }
      })
      .catch(async (error: unknown) => {
      const kind = error instanceof Error ? error.name : 'erro';
      await safeNotify(`Erro interno (${kind}) ao processar o chat ${key}.`);
    });
    queues.set(key, next);
    pending.add(next);
    void next.finally(() => {
      pending.delete(next);
      if (queues.get(key) === next) queues.delete(key);
    });
  }

  // Imagem opcional: falha (arquivo ausente, envio recusado) devolve false e nunca trava a entrega.
  async function sendImage(jid: string, image: { path: string | null; caption: string }): Promise<boolean> {
    if (!image.path) return false;
    try {
      const base64 = (await readFile(image.path)).toString('base64');
      await limiter.acquire(jid);
      const typing = typingDelayMs(image.caption, Math.random, { perCharMs: deps.config.typingMsPerChar });
      const { messageId } = await deps.evolution.sendMedia(
        jid,
        { base64, mimetype: 'image/jpeg', fileName: basename(image.path), caption: image.caption },
        { delayMs: typing },
      );
      if (messageId) deps.store.markSeen(messageId);
      else botActiveUntil.set(jid, deps.now() + BOT_ECHO_WINDOW_MS);
      return true;
    } catch {
      return false;
    }
  }

  // Devolve true só se TODAS as mensagens de texto foram enviadas. As imagens (opcionais) vão antes;
  // se todas as cartas foram como imagem, o cabeçalho em texto (primeira resposta) é dispensado.
  async function sendAll(jid: string, texts: string[], media?: DeliveryMedia): Promise<boolean> {
    if (!isIndividualChat(jid)) {
      await safeNotify(`Envio recusado: ${jid} não é uma conversa individual (grupos e canais nunca recebem resposta).`);
      return false;
    }
    sending.add(jid);
    let allSent = true;
    let missingId = false;
    try {
      // "Lendo e pensando": espera antes de começar (sem aparecer "digitando"), uma vez por resposta.
      const think = thinkDelayMs(deps.config.replyThinkSeconds);
      if (think > 0) await (deps.sleep ?? realSleep)(think);
      let toSend = texts;
      if (media) {
        if (media.shuffling) await sendImage(jid, media.shuffling);
        let cardsSent = 0;
        for (const card of media.cards) if (await sendImage(jid, card)) cardsSent += 1;
        if (cardsSent < media.cards.length) {
          await safeNotify(`Imagens das cartas indisponíveis (${media.cards.length - cardsSent}) no chat ${jid}; seguiu em texto.`);
        } else if (texts.length > 1) {
          toSend = texts.slice(1);
        }
      }
      for (const text of toSend) {
        try {
          await limiter.acquire(jid);
          const typing = typingDelayMs(text, Math.random, { perCharMs: deps.config.typingMsPerChar });
          const { messageId } = await deps.evolution.sendText(jid, text, { delayMs: typing });
          if (messageId) deps.store.markSeen(messageId);
          else missingId = true;
        } catch {
          await safeNotify(`Falha ao enviar mensagem para ${jid}; verifique a Evolution API.`);
          allSent = false;
          break;
        }
      }
    } finally {
      sending.delete(jid);
    }
    if (missingId) botActiveUntil.set(jid, deps.now() + BOT_ECHO_WINDOW_MS);
    return allSent;
  }

  function handleOwnerMessage(msg: InboundMessage): void {
    const conversation = deps.store.getConversation(msg.jid);
    if (!conversation) return;
    const text = msg.text?.trim().toLowerCase() ?? '';
    if (text === '/ia') {
      deps.store.saveConversation({ ...conversation, mode: 'ai' });
      return;
    }
    // Eco do próprio bot: enviando agora, ou (sem id de envio) dentro da janela de tempo.
    if (sending.has(msg.jid) || deps.now() < (botActiveUntil.get(msg.jid) ?? 0)) return;
    if (conversation.mode === 'ai') deps.store.saveConversation({ ...conversation, mode: 'human' });
  }

  async function processMessage(msg: InboundMessage): Promise<void> {
    if (!deps.store.markSeen(msg.messageId)) return;
    if (msg.timestampSec * 1000 < deps.now() - MAX_MESSAGE_AGE_MS) return;
    if (msg.fromMe) {
      handleOwnerMessage(msg);
      return;
    }
    // Chat com mensagens aguardando silêncio já é um lead engajado, mesmo sem conversa gravada ainda.
    const buffered = debouncer.has(msg.jid);
    const decision = decide(msg, {
      conversation:
        deps.store.getConversation(msg.jid) ??
        (buffered ? { jid: msg.jid, mode: 'ai', engagedAt: deps.now(), openChargeId: null, stage: 'greeting' } : null),
      triggerPhrases: deps.config.triggerPhrases,
      blocklist,
    });
    if (!decision.engage) return;
    debouncer.push(msg.jid, msg);
  }

  // Depois do silêncio: junta o que o cliente escreveu e responde uma única vez.
  async function processBatch(jid: string, batch: InboundMessage[]): Promise<void> {
    // O dono pode ter assumido (ou o número ter sido bloqueado) durante a espera.
    if (blocklist.has(jid) || deps.store.getConversation(jid)?.mode === 'human') return;
    const msg = mergeBatch(batch);
    const result = await handleLead(agentDeps, msg);
    await sendAll(jid, result.replies);
    if (result.notifyOwner) await safeNotify(result.notifyOwner);
  }

  // Cartas gravadas na cobrança (a reentrega usa as mesmas) viram imagens; sem assetsDir, só texto.
  function deliveryMedia(chargeId: string): DeliveryMedia | undefined {
    if (!deps.assetsDir) return undefined;
    const charge = deps.store.getCharge(chargeId);
    if (!charge?.cards) return undefined;
    return buildDeliveryMedia(deps.assetsDir, charge.cards, getItem(charge.itemId)?.positions ?? []);
  }

  async function processPayment(chargeId: string): Promise<void> {
    const charge = deps.store.getCharge(chargeId);
    if (!charge) return;
    const status = await confirmPayment({ store: deps.store, pix: deps.pix, now: deps.now }, chargeId);
    if (status === 'mismatch') {
      await safeNotify(`Pagamento com valor diferente na cobrança ${chargeId}; confira manualmente.`);
      return;
    }
    if (status !== 'paid') return;
    const replies = await deliverReading(agentDeps, chargeId);
    if (replies.length === 0) return;

    // Janela de 24 h: a entrega segue (o cliente pagou), mas o dono é avisado.
    const lastInbound = deps.store.getConversation(charge.jid)?.lastInboundAtMs;
    if (typeof lastInbound === 'number' && deps.now() - lastInbound > WINDOW_24H_MS) {
      const hours = Math.floor((deps.now() - lastInbound) / 3_600_000);
      await safeNotify(
        `Entrega da leitura fora da janela de 24 h no chat ${charge.jid} (última mensagem do cliente há ${hours} h).`,
      );
    }
    // "Entregue" só depois de enviar: se falhar, a repetição do webhook tenta de novo.
    if (await sendAll(charge.jid, replies, deliveryMedia(chargeId))) markDelivered(deps.store, chargeId);
  }

  app.addHook('onClose', async () => debouncer.clear());

  app.decorate('settled', async () => {
    while (pending.size > 0) await Promise.all([...pending]);
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Números do painel: tudo vem do banco e da atividade real do serviço (nada é inventado).
  app.get<{ Params: { token: string } }>('/api/stats/:token', async (request, reply) => {
    if (!sameToken(request.params.token, deps.config.webhookToken)) {
      return reply.code(404).send({ error: 'not found' });
    }
    const now = deps.now();
    const counts = deps.store.getStats(now, startOfDayBrt(now));
    const spend = adSpendView(deps.store.getAdSpend(), deps.config.meta !== null, now);
    // Lucro só quando o gasto está fresco e na mesma moeda (BRL): nunca mistura moedas nem usa dado velho.
    const profitable = spend.status === 'ok' && spend.currency === 'BRL' && spend.totalCents !== null && spend.todayCents !== null;
    return {
      generatedAtMs: now,
      ...counts,
      spend,
      profit: profitable
        ? { totalCents: counts.revenue.totalCents - spend.totalCents!, todayCents: counts.revenue.todayCents - spend.todayCents! }
        : { totalCents: null, todayCents: null },
      activity: { processing },
      notices: deps.store.recentNotices(PANEL_NOTICES).map((n) => ({ atMs: n.atMs, text: n.text })),
    };
  });

  // A própria tela do escritório, servida pelo serviço (o painel na Vercel não enxerga o seu PC).
  app.get<{ Params: { token: string } }>('/painel/:token', async (request, reply) => {
    if (!sameToken(request.params.token, deps.config.webhookToken)) {
      return reply.code(404).send({ error: 'not found' });
    }
    panelHtml ??= readFileSync(PANEL_FILE, 'utf8');
    return reply.type('text/html; charset=utf-8').send(panelHtml);
  });

  // Avisos ao dono gravados no banco (para o painel ou para consulta manual).
  app.get<{ Params: { token: string } }>('/notices/:token', async (request, reply) => {
    if (!sameToken(request.params.token, deps.config.webhookToken)) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { notices: deps.store.recentNotices(NOTICES_LIMIT) };
  });

  app.post<{ Params: { token: string } }>('/webhook/evolution/:token', async (request, reply) => {
    if (!sameToken(request.params.token, deps.config.webhookToken)) {
      return reply.code(404).send({ error: 'not found' });
    }
    const msg = parseWebhook(request.body);
    if (!msg) return { ok: true, ignored: 'not_a_message' };
    enqueue(msg.jid, () => processMessage(msg));
    return { ok: true };
  });

  app.post<{ Params: { token: string } }>('/webhook/pix/:token', async (request, reply) => {
    if (!sameToken(request.params.token, deps.config.webhookToken)) {
      return reply.code(404).send({ error: 'not found' });
    }
    const body = pixBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body' });
    const charge = deps.store.getCharge(body.data.chargeId);
    if (!charge) return { ok: true };
    enqueue(charge.jid, () => processPayment(charge.chargeId));
    return { ok: true };
  });

  return app;
}
