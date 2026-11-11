import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { agentJson, JID, makeHarness, TOKEN, upsert } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;

describe('agrupamento de mensagens (debounce de 8 s)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  const cfg = { messageDebounceSeconds: 8 };
  const post = (app: ReturnType<typeof buildServer>, payload: ReturnType<typeof upsert>) =>
    app.inject({ method: 'POST', url: EVO, payload });

  it('várias mensagens seguidas viram uma chamada à IA e uma resposta', async () => {
    const h = makeHarness({ llm: [agentJson('Prazer, Ana!')], config: cfg });
    const app = buildServer(h.deps);
    await post(app, upsert({ id: 'm1', text: 'oi', ad: true }));
    await vi.advanceTimersByTimeAsync(3000);
    await post(app, upsert({ id: 'm2', text: 'meu nome é Ana' })); // sem anúncio: chat já em buffer
    await vi.advanceTimersByTimeAsync(3000);
    await post(app, upsert({ id: 'm3', text: 'quero saber do meu ex' }));
    await vi.advanceTimersByTimeAsync(7999);
    expect(h.llmCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await app.settled();

    expect(h.llmCalls).toHaveLength(1);
    expect(h.llmCalls[0]!.messages.at(-1)!.content).toBe('oi\nmeu nome é Ana\nquero saber do meu ex');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toContain('Ana');
  });

  it('o silêncio é contado a partir da última mensagem', async () => {
    const h = makeHarness({ config: cfg });
    const app = buildServer(h.deps);
    await post(app, upsert({ id: 'm1', text: 'oi', ad: true }));
    await vi.advanceTimersByTimeAsync(7000);
    await post(app, upsert({ id: 'm2', text: 'tem alguém?' }));
    await vi.advanceTimersByTimeAsync(7000);
    expect(h.llmCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    await app.settled();
    expect(h.llmCalls).toHaveLength(1);
  });

  it('mensagem de contato sem anúncio e sem buffer continua ignorada', async () => {
    const h = makeHarness({ config: cfg });
    const app = buildServer(h.deps);
    await post(app, upsert({ id: 'm1', text: 'vamos almoçar?' }));
    await vi.advanceTimersByTimeAsync(20_000);
    await app.settled();
    expect(h.llmCalls).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('se o dono assume o chat durante a espera, a IA não responde', async () => {
    const h = makeHarness({ config: cfg });
    const app = buildServer(h.deps);
    await post(app, upsert({ id: 'm1', text: 'oi', ad: true }));
    // simula o dono tendo assumido (modo humano gravado antes do disparo)
    h.store.saveConversation({ ...(h.store.getConversation(JID) ?? { jid: JID, engagedAt: 1, openChargeId: null, stage: 'greeting' as const }), jid: JID, mode: 'human' });
    await vi.advanceTimersByTimeAsync(8000);
    await app.settled();
    expect(h.llmCalls).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('messageDebounceSeconds 0 desliga o agrupamento (responde na hora)', async () => {
    const h = makeHarness({ config: { messageDebounceSeconds: 0 } });
    const app = buildServer(h.deps);
    await post(app, upsert({ id: 'm1', text: 'oi', ad: true }));
    await app.settled();
    expect(h.llmCalls).toHaveLength(1);
  });
});
