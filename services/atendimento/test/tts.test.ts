import { describe, expect, it } from 'vitest';
import { cleanForSpeech, createEdgeTts, DEFAULT_VOICE, MAX_SPEECH_CHARS } from '../src/tts/edge.js';
import { createFakeTts } from '../src/tts/fake.js';
import { mp3ToOggOpus } from '../src/tts/ffmpeg.js';

describe('cleanForSpeech', () => {
  it('remove emoji, marcadores de markdown e espaços repetidos', () => {
    expect(cleanForSpeech('🔮 *Olá*, _querida_!\n\n\nVamos   ver?')).toBe('Olá, querida!\n\nVamos ver?');
  });
});

describe('createEdgeTts', () => {
  it('sintetiza o texto limpo com a voz configurada e converte o mp3 em ogg/opus', async () => {
    const calls: { text: string; voice: string }[] = [];
    const tts = createEdgeTts({
      voice: 'pt-BR-ThalitaNeural',
      synth: async (text, voice) => {
        calls.push({ text, voice });
        return Buffer.from('mp3');
      },
      convert: async (mp3) => Buffer.concat([Buffer.from('ogg:'), mp3]),
    });

    const out = await tts.synthesize('🔮 Sua *carta*');

    expect(calls).toEqual([{ text: 'Sua carta', voice: 'pt-BR-ThalitaNeural' }]);
    expect(out.toString()).toBe('ogg:mp3');
  });

  it('usa a voz padrão pt-BR', async () => {
    expect(DEFAULT_VOICE).toBe('pt-BR-FranciscaNeural');
    const calls: string[] = [];
    const tts = createEdgeTts({
      synth: async (_t, voice) => {
        calls.push(voice);
        return Buffer.from('x');
      },
      convert: async (b) => b,
    });
    await tts.synthesize('Oi');
    expect(calls).toEqual([DEFAULT_VOICE]);
  });

  it('recusa texto vazio e texto longo demais (o chamador cai para texto)', async () => {
    const tts = createEdgeTts({ synth: async () => Buffer.from('x'), convert: async (b) => b });
    await expect(tts.synthesize('🔮 ')).rejects.toThrow(/vazio/);
    await expect(tts.synthesize('a'.repeat(MAX_SPEECH_CHARS + 1))).rejects.toThrow(/longo/);
  });

  it('propaga falha da síntese e síntese sem áudio', async () => {
    const failing = createEdgeTts({
      synth: async () => {
        throw new Error('ws caiu');
      },
      convert: async (b) => b,
    });
    await expect(failing.synthesize('Oi')).rejects.toThrow('ws caiu');
    const empty = createEdgeTts({ synth: async () => Buffer.alloc(0), convert: async (b) => b });
    await expect(empty.synthesize('Oi')).rejects.toThrow(/sem áudio/);
  });
});

describe('createFakeTts', () => {
  it('devolve bytes determinísticos e registra os textos', async () => {
    const fake = createFakeTts();
    const out = await fake.synthesize('Oi');
    expect(out.subarray(0, 4).toString()).toBe('OggS');
    expect(fake.texts).toEqual(['Oi']);
  });

  it('pode ser configurado para falhar', async () => {
    await expect(createFakeTts({ fail: true }).synthesize('Oi')).rejects.toThrow();
  });
});

describe('mp3ToOggOpus', () => {
  it('dá erro claro quando o ffmpeg não existe', async () => {
    await expect(mp3ToOggOpus(Buffer.from('x'), { bin: 'ffmpeg-que-nao-existe-xyz' })).rejects.toThrow(/ffmpeg/);
  });

  it('devolve a saída do processo e falha com código diferente de zero', async () => {
    const out = await mp3ToOggOpus(Buffer.from('abc'), {
      bin: process.execPath,
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
    });
    expect(out.toString()).toBe('abc');
    await expect(
      mp3ToOggOpus(Buffer.from('abc'), { bin: process.execPath, args: ['-e', 'process.exit(3)'] }),
    ).rejects.toThrow(/ffmpeg.*3/);
  });
});
