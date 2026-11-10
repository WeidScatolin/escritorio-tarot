import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { agentJson, JID, makeHarness, ok, T0, TOKEN, upsert, type Harness } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;
const PIX = `/webhook/pix/${TOKEN}`;

async function fire(h: Harness, app: ReturnType<typeof buildServer>, url: string, payload: unknown) {
  const response = await app.inject({ method: 'POST', url, payload: payload as object });
  await app.settled();
  return response;
}

async function leadFirstMessage(h: Harness) {
  const app = buildServer(h.deps);
  await fire(h, app, EVO, upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }));
  return app;
}

describe('F4: eco do bot reconhecido pelo id, não só pelo tempo', () => {
  it('eco com o id que o bot enviou, mesmo 10 minutos depois, não desliga a IA', async () => {
    const h = makeHarness();
    const app = await leadFirstMessage(h);
    h.clock.t += 10 * 60_000;

    await fire(h, app, EVO, upsert({ id: h.sent[0]!.messageId!, text: 'Oi!', fromMe: true }));

    expect(h.store.getConversation(JID)!.mode).toBe('ai');
  });

  it('dono que digita logo depois da resposta do bot (id diferente) assume na hora', async () => {
    const h = makeHarness();
    const app = await leadFirstMessage(h);
    h.clock.t += 500;

    await fire(h, app, EVO, upsert({ id: 'dono-1', text: 'Oi, sou eu', fromMe: true }));

    expect(h.store.getConversation(JID)!.mode).toBe('human');
  });

  it('se a Evolution não devolver o id do envio, vale a janela de tempo como plano B', async () => {
    const h = makeHarness({ sendReturnsNoId: true });
    const app = await leadFirstMessage(h);

    h.clock.t += 500;
    await fire(h, app, EVO, upsert({ id: 'eco-sem-id', text: 'Oi!', fromMe: true }));
    expect(h.store.getConversation(JID)!.mode).toBe('ai');

    h.clock.t += 60_000;
    await fire(h, app, EVO, upsert({ id: 'dono-2', text: 'assumi', fromMe: true }));
    expect(h.store.getConversation(JID)!.mode).toBe('human');
  });
});

describe('F3: leitura paga não se perde quando o envio falha', () => {
  const script = [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-3-cartas' }), ok('Uma leitura bonita.')];

  it('envio falha na primeira vez, a repetição do webhook reentrega uma única vez', async () => {
    const h = makeHarness({ llm: script });
    const app = await leadFirstMessage(h);
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    const before = h.sent.length;

    h.pix.simulatePayment(chargeId);
    h.flags.sendFails = true;
    await fire(h, app, PIX, { chargeId });
    expect(h.sent.length).toBe(before);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(false);
    expect(h.notices.length).toBeGreaterThan(0);

    h.flags.sendFails = false;
    await fire(h, app, PIX, { chargeId });
    const delivered = h.sent.length - before;
    expect(delivered).toBeGreaterThan(0);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);

    await fire(h, app, PIX, { chargeId });
    expect(h.sent.length - before).toBe(delivered);
  });
});

describe('F12: mensagens antigas', () => {
  it('mensagem com mais de 10 minutos é ignorada (ex.: histórico após reconexão)', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);

    await fire(h, app, EVO, upsert({ id: 'old-1', text: 'Vi o anúncio', ad: true, tsSec: T0 / 1000 - 3600 }));

    expect(h.llmCalls).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('mensagem de 1 minuto atrás ainda é atendida', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);

    await fire(h, app, EVO, upsert({ id: 'new-1', text: 'Vi o anúncio', ad: true, tsSec: T0 / 1000 - 60 }));

    expect(h.sent).toHaveLength(1);
  });
});

describe('F2: avisos ao dono ficam gravados e consultáveis', () => {
  it('um aviso gera registro no banco e aparece em GET /notices/:token', async () => {
    const h = makeHarness({ llm: [{ kind: 'timeout' }] });
    const app = await leadFirstMessage(h);

    expect(h.store.recentNotices(10)).toHaveLength(1);
    const response = await app.inject({ method: 'GET', url: `/notices/${TOKEN}` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { notices: { text: string; atMs: number }[] };
    expect(body.notices).toHaveLength(1);
    expect(body.notices[0]!.text).toContain('IA indisponível');
  });

  it('GET /notices com token errado: 404', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: '/notices/errado' });
    expect(response.statusCode).toBe(404);
  });
});
