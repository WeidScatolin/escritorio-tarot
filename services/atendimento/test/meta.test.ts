import { describe, expect, it } from 'vitest';
import { AdSpendError, createMetaAdSpend } from '../src/ads/meta.js';

const TOKEN = 'EAAB-token-secreto-123';

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const r = responses[Math.min(calls.length, responses.length - 1)]!;
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const make = (fetchImpl: typeof fetch) =>
  createMetaAdSpend({ adAccountId: '1234567890', accessToken: TOKEN, apiVersion: 'v25.0', fetchImpl });

describe('createMetaAdSpend.fetchSpend', () => {
  it('consulta act_{id}/insights no nível da conta com o período pedido; token só no header', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { data: [{ spend: '123.45', account_currency: 'BRL' }] } }]);

    const result = await make(fetchImpl).fetchSpend({ since: '2026-11-01', until: '2026-11-10' });

    expect(result).toEqual({ spendCents: 12345, currency: 'BRL' });
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v25.0/act_1234567890/insights');
    expect(url.searchParams.get('level')).toBe('account');
    expect(url.searchParams.get('fields')).toContain('spend');
    expect(JSON.parse(url.searchParams.get('time_range')!)).toEqual({ since: '2026-11-01', until: '2026-11-10' });
    expect(calls[0]!.url).not.toContain(TOKEN);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ['0.1', 10],
    ['0', 0],
    ['1234.5', 123450],
    ['29.999', 3000],
  ])('converte o gasto "%s" em %i centavos', async (spend, cents) => {
    const { fetchImpl } = fakeFetch([{ body: { data: [{ spend, account_currency: 'BRL' }] } }]);
    expect((await make(fetchImpl).fetchSpend({ since: '2026-11-10', until: '2026-11-10' })).spendCents).toBe(cents);
  });

  it('período sem nenhum gasto (data vazio): zero centavos e a moeda vem da conta', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { data: [] } }, { body: { currency: 'USD', id: 'act_1234567890' } }]);

    const result = await make(fetchImpl).fetchSpend({ since: '2026-11-10', until: '2026-11-10' });

    expect(result).toEqual({ spendCents: 0, currency: 'USD' });
    expect(new URL(calls[1]!.url).pathname).toBe('/v25.0/act_1234567890');
  });

  it.each([
    ['token inválido ou vencido', 401, { error: { message: `Invalid OAuth access token ${TOKEN}`, type: 'OAuthException', code: 190 } }, 'auth'],
    ['limite de chamadas', 400, { error: { message: 'User request limit reached', code: 17 } }, 'rate_limit'],
    ['limite de chamadas (código 4)', 400, { error: { message: 'Application request limit reached', code: 4 } }, 'rate_limit'],
    ['outro erro', 500, { error: { message: 'Unknown error', code: 2 } }, 'other'],
  ])('%s vira AdSpendError(%s) sem vazar o token', async (_name, status, body, kind) => {
    const { fetchImpl } = fakeFetch([{ status, body }]);

    const error = await make(fetchImpl).fetchSpend({ since: '2026-11-10', until: '2026-11-10' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AdSpendError);
    expect((error as AdSpendError).kind).toBe(kind);
    expect((error as AdSpendError).message).not.toContain(TOKEN);
  });

  it('falha de rede vira AdSpendError(network) sem vazar o token', async () => {
    const fetchImpl = (async () => {
      throw new Error(`conexão recusada ${TOKEN}`);
    }) as typeof fetch;

    const error = await make(fetchImpl).fetchSpend({ since: '2026-11-10', until: '2026-11-10' }).catch((e: unknown) => e);

    expect((error as AdSpendError).kind).toBe('network');
    expect((error as AdSpendError).message).not.toContain(TOKEN);
  });

  it('resposta com formato inesperado vira erro "other" (não quebra)', async () => {
    const { fetchImpl } = fakeFetch([{ body: { data: [{ spend: 'abc', account_currency: 'BRL' }] } }]);
    const error = await make(fetchImpl).fetchSpend({ since: '2026-11-10', until: '2026-11-10' }).catch((e: unknown) => e);
    expect((error as AdSpendError).kind).toBe('other');
  });
});
