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

  it('agrupamento de mensagens: 8 s por padrão, configurável, 0 desliga', () => {
    expect(loadConfig(REQUIRED).messageDebounceSeconds).toBe(8);
    expect(loadConfig({ ...REQUIRED, MESSAGE_DEBOUNCE_SECONDS: '3' }).messageDebounceSeconds).toBe(3);
    expect(loadConfig({ ...REQUIRED, MESSAGE_DEBOUNCE_SECONDS: '0' }).messageDebounceSeconds).toBe(0);
    expect(() => loadConfig({ ...REQUIRED, MESSAGE_DEBOUNCE_SECONDS: '-1' })).toThrow(ConfigError);
  });

  it('gasto em anúncios (Meta): desligado por padrão; ligado com conta, token e data de início', () => {
    const off = loadConfig(REQUIRED);
    expect(off.meta).toBeNull();
    expect(off.adSpendPollMinutes).toBe(10);

    const on = loadConfig({ ...REQUIRED, META_AD_ACCOUNT_ID: 'act_123', META_ACCESS_TOKEN: 'tk', META_SPEND_SINCE: '2026-11-01' });
    expect(on.meta).toEqual({ adAccountId: '123', accessToken: 'tk', apiVersion: 'v25.0', spendSince: '2026-11-01' });

    const custom = loadConfig({
      ...REQUIRED,
      META_AD_ACCOUNT_ID: '456',
      META_ACCESS_TOKEN: 'tk',
      META_SPEND_SINCE: '2026-11-01',
      META_API_VERSION: 'v26.0',
      AD_SPEND_POLL_MINUTES: '30',
    });
    expect(custom.meta!.apiVersion).toBe('v26.0');
    expect(custom.meta!.adAccountId).toBe('456');
    expect(custom.adSpendPollMinutes).toBe(30);
  });

  it.each([
    ['sem token', { META_AD_ACCOUNT_ID: '1', META_SPEND_SINCE: '2026-11-01' }, /META_ACCESS_TOKEN/],
    ['sem conta', { META_ACCESS_TOKEN: 'tk', META_SPEND_SINCE: '2026-11-01' }, /META_AD_ACCOUNT_ID/],
    ['sem data de início', { META_AD_ACCOUNT_ID: '1', META_ACCESS_TOKEN: 'tk' }, /META_SPEND_SINCE/],
    ['data inválida', { META_AD_ACCOUNT_ID: '1', META_ACCESS_TOKEN: 'tk', META_SPEND_SINCE: '01/11/2026' }, /META_SPEND_SINCE/],
    ['conta não numérica', { META_AD_ACCOUNT_ID: 'abc', META_ACCESS_TOKEN: 'tk', META_SPEND_SINCE: '2026-11-01' }, /META_AD_ACCOUNT_ID/],
  ])('Meta parcialmente configurada (%s) lança ConfigError', (_name, extra, pattern) => {
    expect(() => loadConfig({ ...REQUIRED, ...extra })).toThrow(ConfigError);
    expect(() => loadConfig({ ...REQUIRED, ...extra })).toThrow(pattern);
  });

  it('o token da Meta nunca aparece na mensagem do erro', () => {
    let message = '';
    try {
      loadConfig({ ...REQUIRED, META_ACCESS_TOKEN: 'EAAB-segredo-xyz' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain('EAAB-segredo-xyz');
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

describe('ENGAGE_ALL_CHATS', () => {
  it('desligado por padrão e ligado com true/1/sim', () => {
    expect(loadConfig(REQUIRED).engageAllChats).toBe(false);
    expect(loadConfig({ ...REQUIRED, ENGAGE_ALL_CHATS: 'true' }).engageAllChats).toBe(true);
    expect(loadConfig({ ...REQUIRED, ENGAGE_ALL_CHATS: '1' }).engageAllChats).toBe(true);
    expect(loadConfig({ ...REQUIRED, ENGAGE_ALL_CHATS: 'não' }).engageAllChats).toBe(false);
  });
});

