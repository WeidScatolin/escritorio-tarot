import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = { EVOLUTION_URL: 'http://e', EVOLUTION_API_KEY: 'k', WEBHOOK_TOKEN: 't', NIM_API_KEY: 'n' };

describe('config TTS', () => {
  it('vem desligado por padrão', () => {
    expect(loadConfig(base).tts).toBeNull();
    expect(loadConfig({ ...base, TTS_ENABLED: 'false' }).tts).toBeNull();
  });

  it('liga com TTS_ENABLED=true e voz padrão Francisca', () => {
    expect(loadConfig({ ...base, TTS_ENABLED: 'true' }).tts).toEqual({ voice: 'pt-BR-FranciscaNeural' });
    expect(loadConfig({ ...base, TTS_ENABLED: '1' }).tts).not.toBeNull();
  });

  it('aceita voz configurável e rejeita voz inválida ou valor estranho', () => {
    expect(loadConfig({ ...base, TTS_ENABLED: 'true', TTS_VOICE: 'pt-BR-ThalitaNeural' }).tts?.voice).toBe(
      'pt-BR-ThalitaNeural',
    );
    expect(() => loadConfig({ ...base, TTS_ENABLED: 'true', TTS_VOICE: 'qualquer coisa' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TTS_ENABLED: 'talvez' })).toThrow(ConfigError);
  });
});
