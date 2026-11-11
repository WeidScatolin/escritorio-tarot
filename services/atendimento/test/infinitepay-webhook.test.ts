import { describe, expect, it } from 'vitest';
import { handleLead } from '../src/agent.js';
import { openCharge } from '../src/payments.js';
import { createInfinitePay } from '../src/pix/infinitepay.js';
import { buildServer } from '../src/server.js';
import { CATALOG } from '../src/catalog.js';
import { JID, makeHarness, TOKEN, agentJson } from './helpers.js';
import type { InboundMessage } from '../src/types.js';

const IP_TOKEN = 'ip-token-fake';
const HOOK = `/webhook/infinitepay/${IP_TOKEN}`;
const LINK = 'https://checkout.infinitepay.io/fake-handle/AbCdEf';
const ITEM = CATALOG[0]!;

type Call = { url: string; body: any };

// Fetch falso: /links devolve o link; /payment_check devolve o que o teste mandar.
function makeProviderFetch(check: () => { status?: number; body?: unknown; throws?: boolean }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith('/links')) return new Response(JSON.stringify({ url: LINK }), { status: 200 });
    const r = check();
    if (r.throws) throw new Error('boom');
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(check: () => { status?: number; body?: unknown; throws?: boolean }) {
  const f = makeProviderFetch(check);
  const h = makeHarness({
    config: {
      infinitepay: { handle: 'fake-handle', apiKey: null, publicBaseUrl: 'https://tarot.example.com', webhookToken: IP_TOKEN },
    },
  });
  const pix = createInfinitePay({
    handle: 'fake-handle',
    apiKey: null,
    webhookUrl: `https://tarot.example.com/webhook/infinitepay/${IP_TOKEN}`,
    fetchImpl: f.fetchImpl,
  });
  const deps = { ...h.deps, pix };
  const app = buildServer(deps);
  return { h, f, app, deps, pix };
}

const paidOk = (cents = ITEM.priceCents) => ({ body: { success: true, paid: true, amount: cents, paid_amount: cents } });
const payload = (orderNsu: string, extra: Record<string, unknown> = {}) => ({
  invoice_slug: 'slug-1',
  amount: ITEM.priceCents,
  paid_amount: ITEM.priceCents,
  installments: 1,
  capture_method: 'pix',
  transaction_nsu: 'tx-1',
  order_nsu: orderNsu,
  receipt_url: 'https://recibo.example/1',
  items: [],
  ...extra,
});

async function newCharge(s: ReturnType<typeof setup>) {
  const charge = await openCharge({ store: s.h.store, pix: s.pix, now: s.h.deps.now }, JID, ITEM.id);
  return charge.chargeId;
}

async function fire(s: ReturnType<typeof setup>, url: string, body: unknown) {
  const response = await s.app.inject({ method: 'POST', url, payload: body as object });
  await s.app.settled();
  return response;
}

describe('POST /webhook/infinitepay/:token', () => {
  it('token errado: 404 e nenhuma chamada ao provedor', async () => {
    const s = setup(() => paidOk());
    const id = await newCharge(s);
    const callsBefore = s.f.calls.length;
    const r = await fire(s, '/webhook/infinitepay/errado', payload(id));
    expect(r.statusCode).toBe(404);
    expect(s.f.calls.length).toBe(callsBefore);
    expect(s.h.store.getCharge(id)!.status).toBe('pending');
  });

  it('o WEBHOOK_TOKEN geral não vale no caminho da InfinitePay quando há token próprio', async () => {
    const s = setup(() => paidOk());
    const id = await newCharge(s);
    const r = await fire(s, `/webhook/infinitepay/${TOKEN}`, payload(id));
    expect(r.statusCode).toBe(404);
  });

  it('com o provedor desligado (fake): 404', async () => {
    const h = makeHarness();
    const app = buildServer(h.deps);
    const r = await app.inject({ method: 'POST', url: HOOK, payload: payload('x') });
    expect(r.statusCode).toBe(404);
  });

  it('order_nsu desconhecido: rejeitado sem chamar payment_check', async () => {
    const s = setup(() => paidOk());
    const r = await fire(s, HOOK, payload('inexistente'));
    expect(r.statusCode).toBe(404);
    expect(s.f.calls.filter((c) => c.url.endsWith('/payment_check'))).toHaveLength(0);
  });

  it('corpo inválido: 400', async () => {
    const s = setup(() => paidOk());
    expect((await fire(s, HOOK, { foo: 'bar' })).statusCode).toBe(400);
  });

  it('pago de verdade: confirma via payment_check, grava comprovante, marca pago e entrega a leitura', async () => {
    const s = setup(() => paidOk());
    const id = await newCharge(s);

    const r = await fire(s, HOOK, payload(id));

    expect(r.statusCode).toBe(200);
    const check = s.f.calls.find((c) => c.url.endsWith('/payment_check'))!;
    expect(check.body).toEqual({ handle: 'fake-handle', order_nsu: id, transaction_nsu: 'tx-1', slug: 'slug-1' });
    const charge = s.h.store.getCharge(id)!;
    expect(charge.status).toBe('paid');
    expect(charge.transactionNsu).toBe('tx-1');
    expect(charge.slug).toBe('slug-1');
    expect(charge.delivered).toBe(true);
    expect(s.h.sent.length).toBeGreaterThan(0);
  });

  it('payload diz pago mas payment_check diz que não: continua pendente (nunca confia no webhook)', async () => {
    const s = setup(() => ({ body: { success: false, paid: false } }));
    const id = await newCharge(s);
    const r = await fire(s, HOOK, payload(id));
    expect(r.statusCode).toBe(200);
    expect(s.h.store.getCharge(id)!.status).toBe('pending');
    expect(s.h.store.getCharge(id)!.transactionNsu).toBeUndefined();
    expect(s.h.sent).toHaveLength(0);
  });

  it('valor pago diferente do da tabela: não entrega e avisa o dono', async () => {
    const s = setup(() => paidOk(100));
    const id = await newCharge(s);
    await fire(s, HOOK, payload(id, { paid_amount: 100 }));
    expect(s.h.store.getCharge(id)!.status).not.toBe('paid');
    expect(s.h.sent).toHaveLength(0);
    expect(s.h.notices.join(' ')).toContain('valor diferente');
  });

  it('webhook repetido: idempotente (uma só entrega, sem nova consulta ao provedor)', async () => {
    const s = setup(() => paidOk());
    const id = await newCharge(s);
    await fire(s, HOOK, payload(id));
    const sentBefore = s.h.sent.length;
    const checksBefore = s.f.calls.filter((c) => c.url.endsWith('/payment_check')).length;

    const r = await fire(s, HOOK, payload(id));

    expect(r.statusCode).toBe(200);
    expect(s.h.sent.length).toBe(sentBefore);
    expect(s.f.calls.filter((c) => c.url.endsWith('/payment_check')).length).toBe(checksBefore);
  });

  it('webhook sem transaction_nsu/slug: 200 ignorado, sem consultar o provedor', async () => {
    const s = setup(() => paidOk());
    const id = await newCharge(s);
    const r = await fire(s, HOOK, { order_nsu: id });
    expect(r.statusCode).toBe(200);
    expect(s.f.calls.filter((c) => c.url.endsWith('/payment_check'))).toHaveLength(0);
    expect(s.h.store.getCharge(id)!.status).toBe('pending');
  });

  it('payment_check fora do ar: 503 para a InfinitePay reenviar; depois do reenvio, confirma', async () => {
    let down = true;
    const s = setup(() => (down ? { status: 502 } : paidOk()));
    const id = await newCharge(s);

    const first = await fire(s, HOOK, payload(id));
    expect(first.statusCode).toBe(503);
    expect(s.h.store.getCharge(id)!.status).toBe('pending');

    down = false;
    const second = await fire(s, HOOK, payload(id));
    expect(second.statusCode).toBe(200);
    expect(s.h.store.getCharge(id)!.status).toBe('paid');
  });

  it('a rota antiga do Pix falso não confirma cobrança InfinitePay sem comprovante', async () => {
    const s = setup(() => paidOk());
    const id = await newCharge(s);
    await s.app.inject({ method: 'POST', url: `/webhook/pix/${TOKEN}`, payload: { chargeId: id } });
    await s.app.settled();
    expect(s.h.store.getCharge(id)!.status).toBe('pending');
  });
});

describe('cobrança por link no atendimento', () => {
  it('a mensagem de cobrança (enviada pelo código) contém o link; o guard da IA continua barrando links da IA', async () => {
    const s = setup(() => paidOk());
    const inbound: InboundMessage = {
      messageId: 'm1',
      jid: JID,
      fromMe: false,
      isGroup: false,
      pushName: null,
      text: 'quero a tiragem',
      timestampSec: s.h.deps.now() / 1000,
      adReferral: null,
    };
    const agentDeps = { llm: { complete: async () => agentJson('Fechado!', { kind: 'charge', itemId: ITEM.id }) }, store: s.h.store, pix: s.pix, now: s.h.deps.now };
    const result = await handleLead(agentDeps as never, inbound);
    const text = result.replies.join('\n');
    expect(text).toContain(`Pague por Pix neste link: ${LINK}`);
    expect(text).not.toMatch(/copia e cola/i);

    const blocked = await handleLead(
      { ...agentDeps, llm: { complete: async () => agentJson(`Pague em ${LINK}`) } } as never,
      { ...inbound, messageId: 'm2', text: 'oi' },
    );
    expect(blocked.replies.join(' ')).not.toContain(LINK);
  });

  it('falha ao criar o link: resposta segura, dono avisado e nenhuma cobrança aberta', async () => {
    const s = setup(() => paidOk());
    const failing = createInfinitePay({
      handle: 'fake-handle',
      apiKey: null,
      webhookUrl: 'https://tarot.example.com/x',
      fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch,
    });
    const inbound = {
      messageId: 'm1',
      jid: JID,
      fromMe: false,
      isGroup: false,
      pushName: null,
      text: 'quero a tiragem',
      timestampSec: s.h.deps.now() / 1000,
      adReferral: null,
    };
    const result = await handleLead(
      { llm: { complete: async () => agentJson('Fechado!', { kind: 'charge', itemId: ITEM.id }) }, store: s.h.store, pix: failing, now: s.h.deps.now } as never,
      inbound,
    );
    expect(result.replies).toHaveLength(1);
    expect(result.notifyOwner).toBeTruthy();
    expect(s.h.store.getConversation(JID)!.openChargeId).toBeNull();
  });
});

