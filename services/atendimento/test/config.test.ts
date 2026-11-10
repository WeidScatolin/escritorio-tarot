import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const REQUIRED = {
  EVOLUTION_URL: 'http://evolution-api:8080',
  EVOLUTION_API_KEY: 'evo-key',
  WEBHOOK_TOKEN: 'tok',
  NIM_API_KEY: 'nim-key',
};

describe('loadConfig', () => {
  it('lança ConfigError listando todas as variáveis obrigatórias que faltam', () => {
    let error: unknown;
    try {
      loadConfig({});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    for (const name of ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'WEBHOOK_TOKEN', 'NIM_API_KEY']) {
      expect(message).toContain(name);
    }
  });

  it('lista só o que falta quando parte das variáveis está presente', () => {
    expect(() => loadConfig({ ...REQUIRED, NIM_API_KEY: undefined })).toThrow(/NIM_API_KEY/);
    expect(() => loadConfig({ ...REQUIRED, NIM_API_KEY: undefined })).not.toThrow(/EVOLUTION_URL/);
  });

  it('aplica os defaults do plano quando só as obrigatórias existem', () => {
    const config = loadConfig(REQUIRED);
    expect(config.nimModel).toBe('google/gemma-4-31b-it');
    expect(config.nimBaseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(config.port).toBe(3100);
    expect(config.instance).toBe('tarot');
    expect(config.triggerPhrases).toEqual([]);
    expect(config.blocklist).toEqual([]);
  });

  it('limites de mensagens por minuto: defaults 6 por conversa e 20 no total, configuráveis', () => {
    const defaults = loadConfig(REQUIRED);
    expect(defaults.maxMsgsPerMinuteChat).toBe(6);
    expect(defaults.maxMsgsPerMinute).toBe(20);

    const custom = loadConfig({ ...REQUIRED, MAX_MSGS_PER_MIN_CHAT: '3', MAX_MSGS_PER_MIN: '10' });
    expect(custom.maxMsgsPerMinuteChat).toBe(3);
    expect(custom.maxMsgsPerMinute).toBe(10);
  });

  it('ritmo das respostas: defaults 14 s pensando e 90 ms por caractere, configuráveis', () => {
    const defaults = loadConfig(REQUIRED);
    expect(defaults.replyThinkSeconds).toBe(14);
    expect(defaults.typingMsPerChar).toBe(90);

    const custom = loadConfig({ ...REQUIRED, REPLY_THINK_SECONDS: '5', TYPING_MS_PER_CHAR: '40' });
    expect(custom.replyThinkSeconds).toBe(5);
    expect(custom.typingMsPerChar).toBe(40);
  });

  it('REPLY_THINK_SECONDS=0 é aceito (desliga a espera inicial)', () => {
    expect(loadConfig({ ...REQUIRED, REPLY_THINK_SECONDS: '0' }).replyThinkSeconds).toBe(0);
  });

  it.each([
    ['REPLY_THINK_SECONDS', '-1'],
    ['REPLY_THINK_SECONDS', 'abc'],
    ['TYPING_MS_PER_CHAR', '0'],
    ['TYPING_MS_PER_CHAR', '1.5'],
  ])('%s inválido (%s) lança ConfigError', (name, value) => {
    expect(() => loadConfig({ ...REQUIRED, [name]: value })).toThrow(ConfigError);
  });

  it.each(['0', '-1', 'abc', '1.5'])('limite inválido "%s" lança ConfigError', (value) => {
    expect(() => loadConfig({ ...REQUIRED, MAX_MSGS_PER_MIN: value })).toThrow(ConfigError);
  });

  it('converte CSV em listas aparando espaços e descartando vazios', () => {
    const config = loadConfig({
      ...REQUIRED,
      TRIGGER_PHRASES: ' quero uma leitura , , tarot ',
      BLOCKLIST: '5511999990000@s.whatsapp.net,,',
    });
    expect(config.triggerPhrases).toEqual(['quero uma leitura', 'tarot']);
    expect(config.blocklist).toEqual(['5511999990000@s.whatsapp.net']);
  });
});
