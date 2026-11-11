import type { TtsClient } from './types.js';

export type FakeTts = TtsClient & {
  /** Textos recebidos, na ordem. */
  readonly texts: string[];
  setFail(fail: boolean): void;
};

// TTS falso para testes: bytes determinísticos com cabeçalho "OggS", sem rede e sem ffmpeg.
export function createFakeTts(opts: { fail?: boolean } = {}): FakeTts {
  const texts: string[] = [];
  let fail = opts.fail ?? false;
  return {
    texts,
    setFail(value) {
      fail = value;
    },
    async synthesize(text) {
      texts.push(text);
      if (fail) throw new Error('TTS falso configurado para falhar');
      return Buffer.concat([Buffer.from('OggS'), Buffer.from(text)]);
    },
  };
}
