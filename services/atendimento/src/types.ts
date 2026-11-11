export type AdReferral = {
  sourceId: string | null;
  sourceUrl: string | null;
  ctwaClid: string | null;
};

export type InboundMessage = {
  messageId: string;
  jid: string;
  fromMe: boolean;
  isGroup: boolean;
  text: string | null;
  pushName: string | null;
  timestampSec: number;
  adReferral: AdReferral | null;
  /** Nota de voz/áudio recebido (o texto vem da transcrição). */
  audio?: { seconds: number | null } | null;
};
