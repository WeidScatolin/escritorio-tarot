import { describe, expect, it, vi } from 'vitest';
import { publishOnce, startPublisher } from '../src/publish.js';

const STATS = { generatedAtMs: 1, revenue: { totalCents: 100 } };

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function makeDeps(fetchFn: typeof fetch, log = vi.fn()) {
  return {
    statsUrl: 'http://127.0.0.1:3100/api/stats/local',
    pushUrl: 'https://exemplo.vercel.app/api/push',
    secret: 'segredo-longo',
    fetchFn,
    log,
  };
}

describe('publishOnce', () => {
  it('lê o resumo local e envia com o segredo no cabeçalho', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('127.0.0.1') ? okJson(STATS) : new Response('{}', { status: 200 }),
    );
    const ok = await publishOnce(makeDeps(fetchFn as unknown as typeof fetch));
    expect(ok).toBe(true);
    const [, init] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer segredo-longo');
    expect(JSON.parse(init.body as string)).toEqual(STATS);
  });

  it('devolve false sem enviar quando o resumo local falha', async () => {
    const fetchFn = vi.fn(async () => new Response('x', { status: 500 }));
    expect(await publishOnce(makeDeps(fetchFn as unknown as typeof fetch))).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('devolve false quando a Vercel recusa', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('127.0.0.1') ? okJson(STATS) : new Response('no', { status: 401 }),
    );
    expect(await publishOnce(makeDeps(fetchFn as unknown as typeof fetch))).toBe(false);
  });

  it('nunca deixa o segredo aparecer no log de erro', async () => {
    const log = vi.fn();
    const fetchFn = vi.fn(async () => {
      throw new Error('falha de rede segredo-longo');
    });
    await publishOnce(makeDeps(fetchFn as unknown as typeof fetch, log));
    expect(JSON.stringify(log.mock.calls)).not.toContain('segredo-longo');
  });
});

describe('startPublisher', () => {
  it('envia logo ao iniciar, repete no intervalo e para ao desligar', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('127.0.0.1') ? okJson(STATS) : new Response('{}', { status: 200 }),
    );
    const stop = startPublisher(makeDeps(fetchFn as unknown as typeof fetch), 60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
