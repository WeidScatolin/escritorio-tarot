import { describe, expect, it } from 'vitest';
import { createInfinitePay, InfinitePayError } from '../src/pix/infinitepay.js';

const API_KEY = 'inchk_FAKE_KEY_123';
const WEBHOOK_URL = 'https://tarot.example.com/webhook/infinitepay/tok-fake';
const LINK = 'https://checkout.infinitepay.io/fake-handle/AbCdEf';

type Call = { url: string; init: RequestInit; body: any };

function fakeFetch(responses: ({ status?: number; body?: unknown; throws?: boolean } | undefined)[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const r = responses[Math.min(calls.length, responses.length - 1)] ?? {};
    calls.push({ url: String(url), init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (r.throws) throw new Error(`socket hang up (X-Api-Key: ${API_KEY})`);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const make = (fetchImpl: typeof fetch, over: { apiKey?: string | null } = {}) =>
  createInfinitePay({ handle: 'fake-handle', apiKey: over.apiKey ?? null, webhookUrl: WEBHOOK_URL, fetchImpl });

const input = { orderId: 'order-1', amountCents: 2900, description: 'Tiragem de 3 cartas' };

describe('infinitepay createCharge', () => {
  it('cria o link com preço em centavos, order_nsu e webhook_url; devolve o link como copyPaste', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { url: LINK } }]);
    const pix = make(fetchImpl);

    const result = await pix.createCharge(input);

    expect(result).toEqual({ chargeId: 'order-1', copyPaste: LINK });
    expect(pix.kind).toBe('link');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.checkout.infinitepay.io/links');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.body).toMatchObject({
      handle: 'fake-handle',
      order_nsu: 'order-1',
      webhook_url: WEBHOOK_URL,
      items: [{ quantity: 1, price: 2900, description: 'Tiragem de 3 cartas' }],
    });
    expect(Number.isInteger(calls[0]!.body.items[0].price)).toBe(true);
  });

  it('sem chave de API: não envia header X-Api-Key nem options', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { url: LINK } }]);
    await make(fetchImpl).createCharge(input);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBeUndefined();
    expect(calls[0]!.body.options).toBeUndefined();
  });

  it('com chave de API: header X-Api-Key e habilita Pix nas opções', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { url: LINK } }]);
    await make(fetchImpl, { apiKey: API_KEY }).createCharge(input);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe(API_KEY);
    expect(calls[0]!.body.options.payment_methods_enabled).toEqual(['credit_card', 'pix']);
    expect(calls[0]!.body.options.single_payment).toBe(true);
    expect(JSON.stringify(calls[0]!.body)).not.toContain(API_KEY);
  });

  it.each(['url', 'link', 'checkout_url', 'payment_url'])('lê o link do campo "%s"', async (field) => {
    const { fetchImpl } = fakeFetch([{ body: { [field]: LINK } }]);
    expect((await make(fetchImpl).createCharge(input)).copyPaste).toBe(LINK);
  });

  it('lê o link também dentro de "data"', async () => {
    const { fetchImpl } = fakeFetch([{ body: { data: { url: LINK } } }]);
    expect((await make(fetchImpl).createCharge(input)).copyPaste).toBe(LINK);
  });

  it('resposta sem nenhum campo de link: erro claro, sem vazar a chave', async () => {
    const { fetchImpl } = fakeFetch([{ body: { id: 'x', echo: API_KEY } }]);
    const error = await make(fetchImpl, { apiKey: API_KEY }).createCharge(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InfinitePayError);
    expect((error as Error).message).toMatch(/link/i);
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('link que não é https é recusado', async () => {
    const { fetchImpl } = fakeFetch([{ body: { url: 'javascript:alert(1)' } }]);
    await expect(make(fetchImpl).createCharge(input)).rejects.toBeInstanceOf(InfinitePayError);
  });

  it('HTTP de erro: erro com o status e sem corpo nem chave', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: { message: `bad key ${API_KEY}` } }]);
    const error = await make(fetchImpl, { apiKey: API_KEY }).createCharge(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InfinitePayError);
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('falha de rede: erro genérico sem vazar a chave da mensagem original', async () => {
    const { fetchImpl } = fakeFetch([{ throws: true }]);
    const error = await make(fetchImpl, { apiKey: API_KEY }).createCharge(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InfinitePayError);
    expect((error as Error).message).not.toContain(API_KEY);
    expect(String((error as Error).cause ?? '')).not.toContain(API_KEY);
  });
});

describe('infinitepay verifyPaid', () => {
  const proof = { transactionNsu: 'tx-1', slug: 'slug-1' };

  it('chama payment_check com handle, order_nsu, transaction_nsu e slug', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { success: true, paid: true, amount: 2900, paid_amount: 2900 } }]);
    const result = await make(fetchImpl).verifyPaid('order-1', proof);

    expect(result).toEqual({ paid: true, paidCents: 2900 });
    expect(calls[0]!.url).toBe('https://api.checkout.infinitepay.io/payment_check');
    expect(calls[0]!.body).toEqual({
      handle: 'fake-handle',
      order_nsu: 'order-1',
      transaction_nsu: 'tx-1',
      slug: 'slug-1',
    });
  });

  it('sem comprovante (transaction_nsu/slug): não chama a rede e não é pago', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { success: true, paid: true, amount: 2900, paid_amount: 2900 } }]);
    expect(await make(fetchImpl).verifyPaid('order-1')).toEqual({ paid: false, paidCents: 0 });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ success: false, paid: false }],
    [{ success: true, paid: false, amount: 2900, paid_amount: 0 }],
    [{ success: false, paid: true, amount: 2900, paid_amount: 2900 }],
    [{}],
  ])('divergência/não pago (%j): paid false', async (body) => {
    const { fetchImpl } = fakeFetch([{ body }]);
    expect(await make(fetchImpl).verifyPaid('order-1', proof)).toEqual({ paid: false, paidCents: 0 });
  });

  it('cartão parcelado com juros: paid_amount maior que o valor do pedido conta o valor do pedido', async () => {
    const { fetchImpl } = fakeFetch([{ body: { success: true, paid: true, amount: 2900, paid_amount: 3100 } }]);
    expect(await make(fetchImpl).verifyPaid('order-1', proof)).toEqual({ paid: true, paidCents: 2900 });
  });

  it('paid_amount menor que o valor do pedido: devolve o menor (vira mismatch)', async () => {
    const { fetchImpl } = fakeFetch([{ body: { success: true, paid: true, amount: 2900, paid_amount: 100 } }]);
    expect(await make(fetchImpl).verifyPaid('order-1', proof)).toEqual({ paid: true, paidCents: 100 });
  });

  it('pago mas sem valores numéricos: não confia (paid false)', async () => {
    const { fetchImpl } = fakeFetch([{ body: { success: true, paid: true } }]);
    expect(await make(fetchImpl).verifyPaid('order-1', proof)).toEqual({ paid: false, paidCents: 0 });
  });

  it('erro HTTP ou de rede lança InfinitePayError (o chamador decide repetir)', async () => {
    await expect(make(fakeFetch([{ status: 500 }]).fetchImpl).verifyPaid('order-1', proof)).rejects.toBeInstanceOf(InfinitePayError);
    await expect(make(fakeFetch([{ throws: true }]).fetchImpl).verifyPaid('order-1', proof)).rejects.toBeInstanceOf(InfinitePayError);
  });
});
