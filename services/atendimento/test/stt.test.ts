import { describe, expect, it } from 'vitest';
import { parseWebhook } from '../src/evolution/parse.js';
import { createWhisperStt } from '../src/stt/whisper.js';
import { loadConfig } from '../src/config.js';

const fakeFetch = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
};

describe('createWhisperStt', () => {
  it('envia o áudio em multipart e devolve o texto', async () => {
    const { fetchImpl, calls } = fakeFetch(200, { text: ' oi, quero tirar cartas ' });
    const stt = createWhisperStt({ baseUrl: 'http://whisper:8000/', model: 'm', fetchImpl });
    expect(await stt.transcribe(Buffer.from('x'), 'audio/ogg; codecs=opus')).toBe('oi, quero tirar cartas');
    expect(calls[0]!.url).toBe('http://whisper:8000/v1/audio/transcriptions');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('m');
    expect(form.get('language')).toBe('pt');
  });
  it('erro HTTP, texto vazio ou falha de rede viram null', async () => {
    expect(await createWhisperStt({ baseUrl: 'http://w', model: 'm', fetchImpl: fakeFetch(500, {}).fetchImpl }).transcribe(Buffer.from('x'), 'audio/ogg')).toBeNull();
    expect(await createWhisperStt({ baseUrl: 'http://w', model: 'm', fetchImpl: fakeFetch(200, { text: '  ' }).fetchImpl }).transcribe(Buffer.from('x'), 'audio/ogg')).toBeNull();
    const boom = (async () => { throw new Error('x'); }) as typeof fetch;
    expect(await createWhisperStt({ baseUrl: 'http://w', model: 'm', fetchImpl: boom }).transcribe(Buffer.from('x'), 'audio/ogg')).toBeNull();
  });
});

describe('parse de áudio e config', () => {
  it('reconhece audioMessage com a duração', () => {
    const msg = parseWebhook({ event: 'messages.upsert', data: { key: { remoteJid: 'a@s.whatsapp.net', id: 'A1', fromMe: false }, messageTimestamp: 1, message: { audioMessage: { seconds: 12, ptt: true } } } });
    expect(msg?.audio).toEqual({ seconds: 12 });
    expect(msg?.text).toBeNull();
  });
  it('STT_URL liga o stt com modelo padrão', () => {
    const base = { EVOLUTION_URL: 'http://e', EVOLUTION_API_KEY: 'k', WEBHOOK_TOKEN: 't', NIM_API_KEY: 'n' };
    expect(loadConfig(base).stt).toBeNull();
    expect(loadConfig({ ...base, STT_URL: 'http://whisper:8000' }).stt?.model).toBe('Systran/faster-whisper-small');
  });
});
