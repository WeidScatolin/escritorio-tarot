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

  it('com delayMs, manda o campo delay (digitação simulada); sem delayMs, não manda', async () => {
    const withDelay = fakeFetch(201);
    const a = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl: withDelay.fetchImpl });
    await a.sendText('a@s.whatsapp.net', 'oi', { delayMs: 2300 });
    expect(JSON.parse(String(withDelay.calls[0]!.init.body))).toEqual({ number: 'a@s.whatsapp.net', text: 'oi', delay: 2300 });

    const without = fakeFetch(201);
    const b = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl: without.fetchImpl });
    await b.sendText('a@s.whatsapp.net', 'oi');
    expect(JSON.parse(String(without.calls[0]!.init.body))).toEqual({ number: 'a@s.whatsapp.net', text: 'oi' });
  });

  it('devolve o id da mensagem enviada (key.id) para o servidor reconhecer o eco', async () => {
    const { fetchImpl } = fakeFetch(201, { key: { id: 'BAE5-ABC' } });
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });
    expect(await client.sendText('a@s.whatsapp.net', 'x')).toEqual({ messageId: 'BAE5-ABC' });
  });

  it('sem id na resposta: messageId null (não quebra)', async () => {
    const { fetchImpl } = fakeFetch(201, { status: 'PENDING' });
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });
    expect(await client.sendText('a@s.whatsapp.net', 'x')).toEqual({ messageId: null });
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

describe('createEvolutionClient.sendMedia', () => {
  const media = { base64: 'QUJD', mimetype: 'image/jpeg', fileName: '00.jpg', caption: 'Passado — O Louco' };

  it('faz POST em /message/sendMedia/{instancia} com imagem em base64 e legenda', async () => {
    const { fetchImpl, calls } = fakeFetch(201, { key: { id: 'M1' } });
    const client = createEvolutionClient({ baseUrl: 'http://evo:8080/', apiKey: API_KEY, instance: 'tarot', fetchImpl });

    const result = await client.sendMedia('a@s.whatsapp.net', media, { delayMs: 1800 });

    expect(result).toEqual({ messageId: 'M1' });
    expect(calls[0]!.url).toBe('http://evo:8080/message/sendMedia/tarot');
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(API_KEY);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      number: 'a@s.whatsapp.net',
      mediatype: 'image',
      mimetype: 'image/jpeg',
      media: 'QUJD',
      fileName: '00.jpg',
      caption: 'Passado — O Louco',
      delay: 1800,
    });
  });

  it('erro não 2xx lança sem vazar a apikey', async () => {
    const { fetchImpl } = fakeFetch(500, { error: API_KEY });
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });
    const error = await client.sendMedia('a@s.whatsapp.net', media).catch((e: Error) => e);
    expect((error as Error).message).toContain('500');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('falha de rede lança sem vazar a apikey', async () => {
    const fetchImpl = (async () => {
      throw new Error(`apikey=${API_KEY}`);
    }) as typeof fetch;
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });
    const error = await client.sendMedia('a@s.whatsapp.net', media).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(API_KEY);
  });
});
