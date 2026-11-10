import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deliverReading, handleLead, markDelivered, type AgentDeps } from './agent.js';
import type { Config } from './config.js';
import type { EvolutionClient } from './evolution/client.js';
import { parseWebhook } from './evolution/parse.js';
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

  // Devolve true só se TODAS as mensagens foram enviadas.
  async function sendAll(jid: string, texts: string[]): Promise<boolean> {
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
      for (const text of texts) {
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
    const decision = decide(msg, {
      conversation: deps.store.getConversation(msg.jid),
      triggerPhrases: deps.config.triggerPhrases,
      blocklist,
    });
    if (!decision.engage) return;

    const result = await handleLead(agentDeps, msg);
    await sendAll(msg.jid, result.replies);
    if (result.notifyOwner) await safeNotify(result.notifyOwner);
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
    if (await sendAll(charge.jid, replies)) markDelivered(deps.store, chargeId);
  }

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
