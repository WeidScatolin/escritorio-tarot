import { describe, expect, it } from 'vitest';
import { createEvolutionClient } from '../src/evolution/client.js';

const API_KEY = 'segredo-da-evolution';

function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('createEvolutionClient.sendText', () => {
  it('faz POST em /message/sendText/{instancia} com apikey no header e número + texto no corpo', async () => {
    const { fetchImpl, calls } = fakeFetch(201);
    const client = createEvolutionClient({ baseUrl: 'http://evo:8080/', apiKey: API_KEY, instance: 'tarot', fetchImpl });

    await client.sendText('5511999990000@s.whatsapp.net', 'Olá!');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://evo:8080/message/sendText/tarot');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(API_KEY);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ number: '5511999990000@s.whatsapp.net', text: 'Olá!' });
  });

  it('resposta não 2xx lança erro sem vazar a apikey', async () => {
    const { fetchImpl } = fakeFetch(401, { error: `apikey ${API_KEY} inválida` });
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });

    const error = await client.sendText('a@s.whatsapp.net', 'x').catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('falha de rede lança erro sem vazar a apikey', async () => {
    const fetchImpl = (async () => {
      throw new Error(`conexão recusada (apikey=${API_KEY})`);
    }) as typeof fetch;
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });

    const error = await client.sendText('a@s.whatsapp.net', 'x').catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(API_KEY);
  });
});
