import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deliverReading, handleLead, type AgentDeps } from './agent.js';
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

// Depois que o bot responde, a Evolution devolve essa mensagem no webhook como "fromMe".
// Dentro desta janela, fromMe é tratado como eco do próprio bot e não como o dono assumindo.
const BOT_ECHO_WINDOW_MS = 5000;

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

  async function safeNotify(text: string): Promise<void> {
    try {
      await deps.notifyOwner(text);
    } catch {
      // Avisar o dono nunca pode derrubar o processamento.
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

  async function sendAll(jid: string, texts: string[]): Promise<void> {
    botActiveUntil.set(jid, deps.now() + BOT_ECHO_WINDOW_MS);
    for (const text of texts) {
      try {
        await deps.evolution.sendText(jid, text);
      } catch {
        await safeNotify(`Falha ao enviar mensagem para ${jid}; verifique a Evolution API.`);
        return;
      }
    }
    botActiveUntil.set(jid, deps.now() + BOT_ECHO_WINDOW_MS);
  }

  function handleOwnerMessage(msg: InboundMessage): void {
    const conversation = deps.store.getConversation(msg.jid);
    if (!conversation) return;
    const text = msg.text?.trim().toLowerCase() ?? '';
    if (text === '/ia') {
      deps.store.saveConversation({ ...conversation, mode: 'ai' });
      return;
    }
    if (deps.now() < (botActiveUntil.get(msg.jid) ?? 0)) return;
    if (conversation.mode === 'ai') deps.store.saveConversation({ ...conversation, mode: 'human' });
  }

  async function processMessage(msg: InboundMessage): Promise<void> {
    if (!deps.store.markSeen(msg.messageId)) return;
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
    if (replies.length > 0) await sendAll(charge.jid, replies);
  }

  app.decorate('settled', async () => {
    while (pending.size > 0) await Promise.all([...pending]);
  });

  app.get('/health', async () => ({ status: 'ok' }));

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
