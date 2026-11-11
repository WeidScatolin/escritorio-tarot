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

describe('createEvolutionClient.sendAudio', () => {
  it('faz POST em /message/sendWhatsAppAudio/{instancia} com o áudio em base64 puro e delay', async () => {
    const { fetchImpl, calls } = fakeFetch(201, { key: { id: 'AUD1' } });
    const client = createEvolutionClient({ baseUrl: 'http://evo:8080/', apiKey: API_KEY, instance: 'tarot', fetchImpl });

    const result = await client.sendAudio('5511999990000@s.whatsapp.net', Buffer.from('ogg-bytes'), { delayMs: 3000 });

    expect(result).toEqual({ messageId: 'AUD1' });
    expect(calls[0]!.url).toBe('http://evo:8080/message/sendWhatsAppAudio/tarot');
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(API_KEY);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      number: '5511999990000@s.whatsapp.net',
      audio: Buffer.from('ogg-bytes').toString('base64'),
      encoding: true,
      delay: 3000,
    });
  });

  it('sem delayMs não manda delay; sem id na resposta devolve null', async () => {
    const { fetchImpl, calls } = fakeFetch(201, {});
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });
    expect((await client.sendAudio('j@s.whatsapp.net', Buffer.from('a'))).messageId).toBeNull();
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty('delay');
  });

  it('erro HTTP não vaza a apikey', async () => {
    const { fetchImpl } = fakeFetch(500);
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });
    const error = await client.sendAudio('j', Buffer.from('a')).catch((e: Error) => e);
    expect((error as Error).message).toContain('500');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('falha de rede vira erro genérico sem a causa', async () => {
    const fetchImpl = (async () => {
      throw new Error(`conexão recusada apikey=${API_KEY}`);
    }) as typeof fetch;
    const client = createEvolutionClient({ baseUrl: 'http://evo', apiKey: API_KEY, instance: 'tarot', fetchImpl });
    const error = await client.sendAudio('j', Buffer.from('a')).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(API_KEY);
  });
});
