import { describe, expect, it } from 'vitest';
import { decide } from '../src/filter.js';
import type { Conversation } from '../src/store.js';
import type { InboundMessage } from '../src/types.js';

const JID = '5511999990000@s.whatsapp.net';

function msg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'm1',
    jid: JID,
    fromMe: false,
    isGroup: false,
    text: 'oi',
    pushName: null,
    timestampSec: 1_700_000_000,
    adReferral: null,
    ...overrides,
  };
}

function conv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    jid: JID,
    mode: 'ai',
    engagedAt: 1_700_000_000,
    openChargeId: null,
    stage: 'greeting',
    ...overrides,
  };
}

const AD = { sourceId: '123', sourceUrl: 'https://fb.me/x', ctwaClid: 'abc' };

function ctx(overrides: Partial<Parameters<typeof decide>[1]> = {}) {
  return { conversation: null, triggerPhrases: [] as string[], blocklist: new Set<string>(), ...overrides };
}

describe('decide', () => {
  it('engaja quando a mensagem vem de anuncio', () => {
    expect(decide(msg({ adReferral: AD }), ctx())).toEqual({ engage: true, reason: 'ad_referral' });
  });

  it('nao engaja sem anuncio, sem gatilho e sem conversa', () => {
    expect(decide(msg(), ctx())).toEqual({ engage: false, reason: 'not_a_lead' });
  });

  it('engaja por frase-gatilho sem diferenciar maiusculas nem acentos', () => {
    const c = ctx({ triggerPhrases: ['Quero uma leitura'] });
    expect(decide(msg({ text: 'OI, QUERO UMA LEITURA, por favor' }), c)).toEqual({
      engage: true,
      reason: 'trigger_phrase',
    });
    const c2 = ctx({ triggerPhrases: ['tarô'] });
    expect(decide(msg({ text: 'Quero saber do TARO' }), c2)).toEqual({
      engage: true,
      reason: 'trigger_phrase',
    });
    const c3 = ctx({ triggerPhrases: ['taro'] });
    expect(decide(msg({ text: 'Quero saber do Tarô' }), c3)).toEqual({
      engage: true,
      reason: 'trigger_phrase',
    });
  });

  it('gatilho vazio ou so espacos nunca casa com tudo', () => {
    expect(decide(msg({ text: 'qualquer coisa' }), ctx({ triggerPhrases: ['', '   '] }))).toEqual({
      engage: false,
      reason: 'not_a_lead',
    });
  });

  it('texto nulo nao casa gatilho', () => {
    expect(decide(msg({ text: null }), ctx({ triggerPhrases: ['oi'] }))).toEqual({
      engage: false,
      reason: 'not_a_lead',
    });
  });

  it('conversa existente com engagedAt continua atendida sem anuncio', () => {
    expect(decide(msg(), ctx({ conversation: conv() }))).toEqual({
      engage: true,
      reason: 'existing_lead',
    });
  });

  it('conversa existente sem engagedAt nao e lead', () => {
    expect(decide(msg(), ctx({ conversation: conv({ engagedAt: null }) }))).toEqual({
      engage: false,
      reason: 'not_a_lead',
    });
  });

  it('conversa em modo human nao engaja', () => {
    expect(decide(msg({ adReferral: AD }), ctx({ conversation: conv({ mode: 'human' }) }))).toEqual({
      engage: false,
      reason: 'human_takeover',
    });
  });

  it('fromMe nao engaja', () => {
    expect(decide(msg({ fromMe: true, adReferral: AD }), ctx())).toEqual({
      engage: false,
      reason: 'from_me',
    });
  });

  it('grupo e status@broadcast contam como group', () => {
    expect(decide(msg({ isGroup: true, adReferral: AD }), ctx())).toEqual({
      engage: false,
      reason: 'group',
    });
    expect(decide(msg({ jid: 'status@broadcast', adReferral: AD }), ctx())).toEqual({
      engage: false,
      reason: 'group',
    });
    expect(decide(msg({ jid: '1203@g.us', adReferral: AD }), ctx())).toEqual({
      engage: false,
      reason: 'group',
    });
  });

  it('jid na lista de bloqueio nao engaja, mesmo com anuncio', () => {
    const c = ctx({ blocklist: new Set([JID]) });
    expect(decide(msg({ adReferral: AD }), c)).toEqual({ engage: false, reason: 'blocklisted' });
  });

  it('lista de bloqueio e por jid exato', () => {
    const c = ctx({ blocklist: new Set(['5511999990000']) });
    expect(decide(msg({ adReferral: AD }), c)).toEqual({ engage: true, reason: 'ad_referral' });
  });

  it('precedencia: from_me vence group, blocklisted e human_takeover', () => {
    const c = ctx({ blocklist: new Set([JID]), conversation: conv({ mode: 'human' }) });
    expect(decide(msg({ fromMe: true, isGroup: true }), c).reason).toBe('from_me');
    expect(decide(msg({ isGroup: true }), c).reason).toBe('group');
    expect(decide(msg(), c).reason).toBe('blocklisted');
    expect(decide(msg(), ctx({ conversation: conv({ mode: 'human' }) })).reason).toBe('human_takeover');
  });

  it('e pura: nao altera as entradas', () => {
    const blocklist = new Set<string>();
    const phrases = ['oi'];
    const c = ctx({ blocklist, triggerPhrases: phrases });
    decide(msg(), c);
    expect(blocklist.size).toBe(0);
    expect(phrases).toEqual(['oi']);
  });
});
