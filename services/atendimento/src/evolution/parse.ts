import type { AdReferral, InboundMessage } from '../types.js';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function parseTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // Baileys/Evolution pode serializar Long como string ou { low, high }.
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  if (isObj(v) && typeof v.low === 'number' && Number.isFinite(v.low)) return v.low;
  return null;
}

function parseAdReferral(contextInfo: unknown): AdReferral | null {
  if (!isObj(contextInfo) || !isObj(contextInfo.externalAdReply)) return null;
  const ad = contextInfo.externalAdReply;
  return {
    sourceId: str(ad.sourceId),
    sourceUrl: str(ad.sourceUrl),
    ctwaClid: str(ad.ctwaClid),
  };
}

function parseValidated(body: unknown): InboundMessage | null {
  if (!isObj(body) || body.event !== 'messages.upsert' || !isObj(body.data)) return null;
  const data = body.data;
  if (!isObj(data.key)) return null;
  const jid = str(data.key.remoteJid);
  const messageId = str(data.key.id);
  const timestampSec = parseTimestamp(data.messageTimestamp);
  if (jid === null || messageId === null || timestampSec === null) return null;

  const message = isObj(data.message) ? data.message : {};
  const extended = isObj(message.extendedTextMessage) ? message.extendedTextMessage : null;
  const text = str(message.conversation) ?? (extended ? str(extended.text) : null);

  const audioMsg = isObj(message.audioMessage) ? message.audioMessage : null;
  const seconds = audioMsg && typeof audioMsg.seconds === 'number' ? audioMsg.seconds : null;

  return {
    messageId,
    jid,
    fromMe: data.key.fromMe === true,
    isGroup: jid.endsWith('@g.us'),
    text,
    pushName: str(data.pushName),
    timestampSec,
    adReferral: extended ? parseAdReferral(extended.contextInfo) : null,
    audio: audioMsg ? { seconds } : null,
  };
}

/** Nunca lança: qualquer entrada inesperada (inclusive JSON inválido em string) devolve null. */
export function parseWebhook(body: unknown): InboundMessage | null {
  try {
    return parseValidated(body);
  } catch {
    return null;
  }
}
