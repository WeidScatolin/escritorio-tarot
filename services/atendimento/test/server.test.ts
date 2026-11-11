import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { agentJson, API_KEY, JID, makeHarness, ok, TOKEN, upsert, type Harness } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;
const PIX = `/webhook/pix/${TOKEN}`;

async function post(h: Harness, url: string, payload: unknown) {
  const app = buildServer(h.deps);
  const response = await app.inject({ method: 'POST', url, payload: payload as object });
  await app.settled();
  return { app, response };
}

async function sendMessages(h: Harness, ...messages: ReturnType<typeof upsert>[]) {
  const app = buildServer(h.deps);
  for (const payload of messages) {
    await app.inject({ method: 'POST', url: EVO, payload });
    await app.settled();
  }
  return app;
}

describe('GET /health', () => {
  it('responde ok com todas as dependências', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /webhook/evolution/:token', () => {
  it('lead novo (com anúncio): responde uma vez ao cliente', async () => {
    const h = makeHarness({ llm: [agentJson('Olá! Posso te ajudar com uma tiragem?')] });
    const { response } = await post(h, EVO, upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }));

    expect(response.statusCode).toBe(200);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.jid).toBe(JID);
    expect(h.sent[0]!.text).toContain('Olá!');
  });

  it('contato sem anúncio: nenhuma resposta e nenhuma chamada ao LLM', async () => {
    const h = makeHarness();
    const { response } = await post(h, EVO, upsert({ id: 'm1', text: 'oi, tudo bem? vamos almoçar?' }));

    expect(response.statusCode).toBe(200);
    expect(h.sent).toHaveLength(0);
    expect(h.llmCalls).toHaveLength(0);
    expect(h.store.getConversation(JID)).toBeNull();
  });

  it('token errado: 404 e nada é processado', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/evolution/errado',
      payload: upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }),
    });
    await app.settled();

    expect(response.statusCode).toBe(404);
    expect(h.llmCalls).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('mesmo messageId duas vezes: uma resposta e uma cobrança só', async () => {
    const h = makeHarness({ llm: [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' })] });
    const payload = upsert({ id: 'dup-1', text: 'quero a de 3 cartas', ad: true });

    await sendMessages(h, payload, payload);

    expect(h.llmCalls).toHaveLength(1);
    expect(h.sent).toHaveLength(3);
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    expect(h.store.getCharge(chargeId)!.status).toBe('pending');
  });

  it('payload que não é mensagem (ou lixo): 200 sem processar', async () => {
    const h = makeHarness();
    const { response } = await post(h, EVO, { event: 'connection.update', data: {} });
    expect(response.statusCode).toBe(200);
    expect(h.llmCalls).toHaveLength(0);
  });

  it('IA indisponível: manda uma mensagem segura ao cliente e avisa o dono', async () => {
    const h = makeHarness({ llm: [{ kind: 'timeout' }] });
    await post(h, EVO, upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }));

    expect(h.sent).toHaveLength(1);
    expect(h.notices).toHaveLength(1);
    expect(h.llmCalls).toHaveLength(1);
  });

  it('falha ao enviar pela Evolution: responde 200, avisa o dono e não vaza a apikey', async () => {
    const h = makeHarness({ sendFails: true });
    const { response } = await post(h, EVO, upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }));

    expect(response.statusCode).toBe(200);
    expect(h.notices.length).toBeGreaterThan(0);
    for (const notice of h.notices) expect(notice).not.toContain(API_KEY);
  });
});

describe('takeover do dono', () => {
  async function leadThenOwner(h: Harness, ownerText: string, afterMs: number) {
    const app = await sendMessages(h, upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }));
    h.clock.t += afterMs;
    await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'o1', text: ownerText, fromMe: true }) });
    await app.settled();
    return app;
  }

  it('dono responde na mão: a conversa vira human e a IA para de responder', async () => {
    const h = makeHarness();
    const app = await leadThenOwner(h, 'Oi, aqui é a Mística de verdade', 60_000);
    expect(h.store.getConversation(JID)!.mode).toBe('human');

    const sentBefore = h.sent.length;
    const callsBefore = h.llmCalls.length;
    await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm2', text: 'então, qual o valor?' }) });
    await app.settled();

    expect(h.sent.length).toBe(sentBefore);
    expect(h.llmCalls.length).toBe(callsBefore);
  });

  it('eco da própria resposta do bot (fromMe com o id que o bot enviou) NÃO desliga a IA', async () => {
    const h = makeHarness();
    const app = await sendMessages(h, upsert({ id: 'm1', text: 'Vi o anúncio', ad: true }));
    h.clock.t += 500;
    await app.inject({
      method: 'POST',
      url: EVO,
      payload: upsert({ id: h.sent[0]!.messageId!, text: 'Oi!', fromMe: true }),
    });
    await app.settled();
    expect(h.store.getConversation(JID)!.mode).toBe('ai');
  });

  it('"/ia" do dono devolve a conversa para a IA', async () => {
    const h = makeHarness();
    const app = await leadThenOwner(h, 'assumi aqui', 60_000);
    expect(h.store.getConversation(JID)!.mode).toBe('human');

    h.clock.t += 60_000;
    await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'o2', text: '/ia', fromMe: true }) });
    await app.settled();

    expect(h.store.getConversation(JID)!.mode).toBe('ai');
  });

  it('dono falando num chat que não é lead: nada acontece', async () => {
    const h = makeHarness();
    await post(h, EVO, upsert({ id: 'o1', text: 'oi mãe', fromMe: true, jid: '5511888880000@s.whatsapp.net' }));
    expect(h.store.getConversation('5511888880000@s.whatsapp.net')).toBeNull();
    expect(h.sent).toHaveLength(0);
  });
});

describe('POST /webhook/pix/:token', () => {
  async function leadWithOpenCharge(h: Harness) {
    const app = await sendMessages(h, upsert({ id: 'm1', text: 'quero a de 3 cartas', ad: true }));
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    return { app, chargeId };
  }
  const script = [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' }), ok('Uma leitura bonita.')];

  it('pagamento confirmado pelo provedor: entrega a leitura uma única vez', async () => {
    const h = makeHarness({ llm: script });
    const { app, chargeId } = await leadWithOpenCharge(h);
    const before = h.sent.length;

    h.pix.simulatePayment(chargeId);
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();

    const delivered = h.sent.slice(before);
    expect(delivered.length).toBeGreaterThan(0);
    const cards = h.store.getCharge(chargeId)!.cards!;
    for (const card of cards) expect(delivered.map((m) => m.text).join('\n')).toContain(card);
    expect(h.store.getCharge(chargeId)!.status).toBe('paid');

    const afterFirst = h.sent.length;
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();
    expect(h.sent.length).toBe(afterFirst);
  });

  it('webhook sem pagamento real no provedor: não entrega nada', async () => {
    const h = makeHarness({ llm: script });
    const { app, chargeId } = await leadWithOpenCharge(h);
    const before = h.sent.length;

    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();

    expect(h.sent.length).toBe(before);
    expect(h.store.getCharge(chargeId)!.status).toBe('pending');
  });

  it('valor pago diferente do cobrado: não entrega e avisa o dono', async () => {
    const h = makeHarness({ llm: script });
    const { app, chargeId } = await leadWithOpenCharge(h);
    const before = h.sent.length;

    h.pix.simulatePayment(chargeId, 100);
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();

    expect(h.sent.length).toBe(before);
    expect(h.notices.length).toBeGreaterThan(0);
  });

  it('chargeId desconhecido: 200 e nada acontece', async () => {
    const h = makeHarness();
    const { response } = await post(h, PIX, { chargeId: 'nao-existe' });
    expect(response.statusCode).toBe(200);
    expect(h.sent).toHaveLength(0);
  });

  it('corpo inválido: 400', async () => {
    const h = makeHarness();
    const { response } = await post(h, PIX, { foo: 'bar' });
    expect(response.statusCode).toBe(400);
  });

  it('token errado: 404', async () => {
    const h = makeHarness();
    const { response } = await post(h, '/webhook/pix/errado', { chargeId: 'x' });
    expect(response.statusCode).toBe(404);
  });
});
