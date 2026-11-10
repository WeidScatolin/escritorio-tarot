import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWebhook } from '../src/evolution/parse.js';

// Fixtures em test/fixtures: formato ASSUMIDO, trocar por payload real capturado (Task 9).
const raw = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const fixture = (name: string): unknown => JSON.parse(raw(name));

describe('parseWebhook', () => {
  it('le texto simples sem adReferral', () => {
    const msg = parseWebhook(fixture('text-simple'));
    expect(msg).toEqual({
      messageId: 'ABC-text-simple',
      jid: '5511999990000@s.whatsapp.net',
      fromMe: false,
      isGroup: false,
      text: 'Oi, quero uma tiragem',
      pushName: 'Maria',
      timestampSec: 1760000000,
      adReferral: null,
    });
  });

  it('le extendedTextMessage com externalAdReply', () => {
    const msg = parseWebhook(fixture('ad-referral'));
    expect(msg?.text).toBe('Vi o anúncio');
    expect(msg?.adReferral).toEqual({
      sourceId: '120210000000001',
      sourceUrl: 'https://fb.me/abc',
      ctwaClid: 'CLID123',
    });
  });

  it('audio devolve text null', () => {
    const msg = parseWebhook(fixture('audio'));
    expect(msg).not.toBeNull();
    expect(msg?.text).toBeNull();
  });

  it('marca grupo', () => {
    expect(parseWebhook(fixture('group'))?.isGroup).toBe(true);
  });

  it('marca fromMe', () => {
    expect(parseWebhook(fixture('from-me'))?.fromMe).toBe(true);
  });

  it('evento que nao e messages.upsert devolve null', () => {
    expect(parseWebhook(fixture('other-event'))).toBeNull();
  });

  it('JSON invalido (texto cru) devolve null', () => {
    expect(parseWebhook(raw('invalid'))).toBeNull();
  });

  it.each([null, undefined, 42, 'x', [], {}, { event: 'messages.upsert' }, { event: 'messages.upsert', data: { key: {} } }])(
    'entrada inesperada %j devolve null sem lancar',
    (input) => {
      expect(parseWebhook(input)).toBeNull();
    },
  );
});
