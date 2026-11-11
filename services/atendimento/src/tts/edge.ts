import { EdgeTTS } from '@andresaya/edge-tts';
import { mp3ToOggOpus } from './ffmpeg.js';
import type { TtsClient } from './types.js';

export const DEFAULT_VOICE = 'pt-BR-FranciscaNeural';
/** Acima disto a leitura fica longa demais para uma nota de voz: o chamador cai para texto. */
export const MAX_SPEECH_CHARS = 3000;

// Emoji e marcas de formatação do WhatsApp não devem ser lidos em voz alta.
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
    .replace(/[*_~`]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type EdgeTtsOptions = {
  voice?: string;
  /** Troca a chamada ao serviço da Microsoft (testes). */
  synth?: (text: string, voice: string) => Promise<Buffer>;
  /** Troca a conversão mp3 -> ogg/opus (testes). */
  convert?: (mp3: Buffer) => Promise<Buffer>;
};

async function synthWithEdge(text: string, voice: string): Promise<Buffer> {
  const result = await new EdgeTTS().generate(text, voice);
  return Buffer.from(result.audio);
}

export function createEdgeTts(opts: EdgeTtsOptions = {}): TtsClient {
  const voice = opts.voice ?? DEFAULT_VOICE;
  const synth = opts.synth ?? synthWithEdge;
  const convert = opts.convert ?? ((mp3: Buffer) => mp3ToOggOpus(mp3));
  return {
    async synthesize(text) {
      const speech = cleanForSpeech(text);
      if (!speech) throw new Error('TTS: texto vazio');
      if (speech.length > MAX_SPEECH_CHARS) throw new Error('TTS: texto longo demais para áudio');
      const mp3 = await synth(speech, voice);
      if (mp3.length === 0) throw new Error('TTS: serviço devolveu resposta sem áudio');
      return convert(mp3);
    },
  };
}
