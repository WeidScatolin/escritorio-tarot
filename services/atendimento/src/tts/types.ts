/** Síntese de voz: texto -> nota de voz (ogg/opus, o formato que o WhatsApp aceita como PTT). */
export type TtsClient = {
  synthesize(text: string): Promise<Buffer>;
};
