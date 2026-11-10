import { describe, expect, it } from 'vitest';
import { createNimClient } from '../src/llm/nim.js';

const API_KEY = 'nvapi-chave-de-teste-nao-real';
const INPUT = {
  system: 'Voce atende leads de tarot.',
  messages: [{ role: 'user' as const, content: 'Oi, quero saber de tarot' }],
};

type Call = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return createNimClient({
    apiKey: API_KEY,
    baseUrl: 'https://nim.test/v1',
    model: 'google/gemma-4-31b-it',
    timeoutMs,
    fetchImpl,
  });
}

function recordingFetch(response: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('createNimClient', () => {
  it('retorna ok com o texto de choices[0].message.content', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'Ola! Como posso ajudar?' } }] }),
    );
    const result = await makeClient(fetchImpl).complete(INPUT);
    expect(result).toEqual({ kind: 'ok', text: 'Ola! Como posso ajudar?' });
  });

  it('envia POST em {baseUrl}/chat/completions com modelo, system, mensagens, max_tokens e temperature', async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await makeClient(fetchImpl).complete(INPUT);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://nim.test/v1/chat/completions');
    expect(call.init.method).toBe('POST');
    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe('google/gemma-4-31b-it');
    expect(body.max_tokens).toBe(400);
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toEqual([
      { role: 'system', content: INPUT.system },
      { role: 'user', content: 'Oi, quero saber de tarot' },
    ]);
  });

  it('a chave vai so no header Authorization, nunca no corpo', async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await makeClient(fetchImpl).complete(INPUT);
    const call = calls[0]!;
    const headers = new Headers(call.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(call.init.body as string).not.toContain(API_KEY);
  });

  it('422 vira blocked', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(422, { error: 'filtered' }));
    expect(await makeClient(fetchImpl).complete(INPUT)).toEqual({ kind: 'blocked' });
  });

  it.each([404, 410])('%i vira unavailable', async (status) => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(status, { error: 'gone' }));
    expect(await makeClient(fetchImpl).complete(INPUT)).toEqual({ kind: 'unavailable' });
  });

  it.each([400, 401, 429, 500, 503])('outro erro HTTP %i vira unavailable', async (status) => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(status, { error: 'x' }));
    expect(await makeClient(fetchImpl).complete(INPUT)).toEqual({ kind: 'unavailable' });
  });

  it('fetch que nunca resolve estoura timeoutMs e vira timeout', async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const result = await makeClient(fetchImpl, 50).complete(INPUT);
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('fetch que nunca resolve e ignora o sinal de abort tambem vira timeout', async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as typeof fetch;
    const result = await makeClient(fetchImpl, 50).complete(INPUT);
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('erro de rede vira unavailable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await makeClient(fetchImpl).complete(INPUT)).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['content vazio', { choices: [{ message: { content: '' } }] }],
    ['content so com espacos', { choices: [{ message: { content: '   ' } }] }],
    ['content nulo', { choices: [{ message: { content: null } }] }],
    ['sem choices', { choices: [] }],
    ['corpo inesperado', { foo: 'bar' }],
  ])('200 com %s vira unavailable', async (_name, body) => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(200, body));
    expect(await makeClient(fetchImpl).complete(INPUT)).toEqual({ kind: 'unavailable' });
  });

  it('200 com corpo que nao e JSON vira unavailable', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('<html>oops</html>', { status: 200 }));
    expect(await makeClient(fetchImpl).complete(INPUT)).toEqual({ kind: 'unavailable' });
  });

  it('nao tenta de novo: uma unica chamada mesmo em falha', async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse(500, {}));
    await makeClient(fetchImpl).complete(INPUT);
    expect(calls).toHaveLength(1);
  });

  it('a chave nunca aparece no resultado de falha', async () => {
    const fetchImpl = (async () => {
      throw new Error(`boom ${API_KEY}`);
    }) as typeof fetch;
    const result = await makeClient(fetchImpl).complete(INPUT);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});
