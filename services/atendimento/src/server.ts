import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deliverReading, handleLead, markDelivered, type AgentDeps } from './agent.js';
import type { Config } from './config.js';
import type { EvolutionClient } from './evolution/client.js';
import { parseWebhook } from './evolution/parse.js';
import { decide } from './filter.js';
import type { LlmClient } from './llm/nim.js';
import { confirmPayment } from './payments.js';
import type { PixProvider } from './pix/provider.js';
import type { Store } from './store.js';
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
  const botActiveUntil = new Map<string, number>();
  const sending = new Set<string>();

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
    const next = previous.then(task).catch(async (error: unknown) => {
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
    sending.add(jid);
    let allSent = true;
    let missingId = false;
    try {
      for (const text of texts) {
        try {
          const { messageId } = await deps.evolution.sendText(jid, text);
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
    const status = await confirmPayment({ store: deps.store, pix: deps.pix }, chargeId);
    if (status === 'mismatch') {
      await safeNotify(`Pagamento com valor diferente na cobrança ${chargeId}; confira manualmente.`);
      return;
    }
    if (status !== 'paid') return;
    const replies = await deliverReading(agentDeps, chargeId);
    if (replies.length === 0) return;
    // "Entregue" só depois de enviar: se falhar, a repetição do webhook tenta de novo.
    if (await sendAll(charge.jid, replies)) markDelivered(deps.store, chargeId);
  }

  app.decorate('settled', async () => {
    while (pending.size > 0) await Promise.all([...pending]);
  });

  app.get('/health', async () => ({ status: 'ok' }));

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
