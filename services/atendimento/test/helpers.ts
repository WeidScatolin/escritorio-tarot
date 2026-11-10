import type { Config } from '../src/config.js';
import type { EvolutionClient } from '../src/evolution/client.js';
import type { LlmClient, LlmResult } from '../src/llm/nim.js';
import { createFakePix } from '../src/pix/fake.js';
import type { ServerDeps } from '../src/server.js';
import { createStore } from '../src/store.js';

export const TOKEN = 'tok-test';
export const API_KEY = 'evo-secret-key-123';
export const JID = '5511999990000@s.whatsapp.net';
export const T0 = 1_700_000_000_000;

export function makeConfig(over: Partial<Config> = {}): Config {
  return {
    port: 3100,
    evolutionUrl: 'http://evolution-api:8080',
    evolutionApiKey: API_KEY,
    instance: 'tarot',
    webhookToken: TOKEN,
    nimApiKey: 'nim-key',
    nimBaseUrl: 'https://nim.example/v1',
    nimModel: 'm',
    triggerPhrases: [],
    blocklist: [],
    dbPath: ':memory:',
    maxMsgsPerMinuteChat: 50,
    maxMsgsPerMinute: 500,
    // Nos testes a espera inicial fica desligada, salvo nos que a exercitam.
    replyThinkSeconds: 0,
    typingMsPerChar: 90,
    meta: null,
    adSpendPollMinutes: 10,
    ...over,
  };
}

export const ok = (text: string): LlmResult => ({ kind: 'ok', text });
export const agentJson = (reply: string, action: unknown = { kind: 'none' }): LlmResult =>
  ok(JSON.stringify({ reply, action }));

export type Harness = ReturnType<typeof makeHarness>;

export function makeHarness(
  opts: { llm?: LlmResult[]; config?: Partial<Config>; sendFails?: boolean; sendReturnsNoId?: boolean } = {},
) {
  const sent: { jid: string; text: string; messageId: string | null; delayMs: number | undefined }[] = [];
  const sleeps: number[] = [];
  const notices: string[] = [];
  const llmCalls: { system: string; messages: { role: string; content: string }[] }[] = [];
  const clock = { t: T0 };
  const flags = { sendFails: opts.sendFails ?? false };
  const results = opts.llm ?? [agentJson('Oi!')];
  let counter = 0;

  const llm: LlmClient = {
    async complete(input) {
      llmCalls.push(input);
      return results[Math.min(llmCalls.length - 1, results.length - 1)]!;
    },
  };
  const evolution: EvolutionClient = {
    async sendText(jid, text, sendOpts) {
      if (flags.sendFails) throw new Error(`boom apikey=${API_KEY}`);
      counter += 1;
      const messageId = opts.sendReturnsNoId ? null : `sent-${counter}`;
      sent.push({ jid, text, messageId, delayMs: sendOpts?.delayMs });
      return { messageId };
    },
  };

  const store = createStore(':memory:');
  const pix = createFakePix();
  const deps: ServerDeps = {
    config: makeConfig(opts.config),
    store,
    llm,
    pix,
    evolution,
    now: () => clock.t,
    // Espera simulada: registra e avança o relógio falso, sem esperar de verdade.
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    notifyOwner: (text) => {
      notices.push(text);
    },
  };
  return { deps, sent, sleeps, notices, llmCalls, clock, flags, store, pix };
}

export function upsert(o: {
  id: string;
  text: string | null;
  jid?: string;
  fromMe?: boolean;
  ad?: boolean;
  tsSec?: number;
}) {
  const text = o.text;
  const message =
    text === null
      ? { audioMessage: { seconds: 3 } }
      : o.ad
        ? {
            extendedTextMessage: {
              text,
              contextInfo: { externalAdReply: { sourceId: '120210000000001', sourceUrl: 'https://fb.me/abc', ctwaClid: 'CLID' } },
            },
          }
        : { conversation: text };
  return {
    event: 'messages.upsert',
    instance: 'tarot',
    data: {
      key: { remoteJid: o.jid ?? JID, fromMe: o.fromMe ?? false, id: o.id },
      pushName: 'Maria',
      messageTimestamp: o.tsSec ?? T0 / 1000,
      message,
    },
  };
}
