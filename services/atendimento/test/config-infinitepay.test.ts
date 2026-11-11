import { describe, expect, it, test } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const BASE = {
  EVOLUTION_URL: 'http://evolution-api:8080',
  EVOLUTION_API_KEY: 'evo-key',
  WEBHOOK_TOKEN: 'tok-base-xyz',
  NIM_API_KEY: 'nim-key',
};
const IP = {
  ...BASE,
  PIX_PROVIDER: 'infinitepay',
  INFINITEPAY_HANDLE: 'fake-handle',
  PUBLIC_BASE_URL: 'https://tarot.example.com/',
};

describe('config: provedor de Pix', () => {
  it('padrão é o fake (infinitepay desligado)', () => {
    expect(loadConfig(BASE).infinitepay ?? null).toBeNull();
    expect(loadConfig({ ...BASE, PIX_PROVIDER: 'fake' }).infinitepay ?? null).toBeNull();
  });

  it('PIX_PROVIDER desconhecido falha', () => {
    expect(() => loadConfig({ ...BASE, PIX_PROVIDER: 'mercadopago' })).toThrow(ConfigError);
  });

  it('infinitepay completo: handle sem $, base sem barra final, chave opcional', () => {
    const c = loadConfig({ ...IP, INFINITEPAY_HANDLE: '$fake-handle' });
    expect(c.infinitepay).toEqual({
      handle: 'fake-handle',
      apiKey: null,
      publicBaseUrl: 'https://tarot.example.com',
      tunnelMetricsUrl: null,
      webhookToken: 'tok-base-xyz',
    });
    expect(loadConfig({ ...IP, INFINITEPAY_API_KEY: 'inchk_FAKE' }).infinitepay?.apiKey).toBe('inchk_FAKE');
  });

  it('token próprio do webhook da InfinitePay quando informado', () => {
    expect(loadConfig({ ...IP, INFINITEPAY_WEBHOOK_TOKEN: 'outro' }).infinitepay?.webhookToken).toBe('outro');
  });

  it('faltando obrigatórios: lista os nomes, sem imprimir valores de segredo', () => {
    let error: unknown;
    try {
      loadConfig({ ...BASE, PIX_PROVIDER: 'infinitepay', INFINITEPAY_API_KEY: 'inchk_SEGREDO' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('INFINITEPAY_HANDLE');
    expect(message).toContain('PUBLIC_BASE_URL');
    expect(message).not.toContain('inchk_SEGREDO');
    expect(message).not.toContain('tok-base-xyz');
  });

  it('PUBLIC_BASE_URL precisa ser https', () => {
    expect(() => loadConfig({ ...IP, PUBLIC_BASE_URL: 'http://tarot.example.com' })).toThrow(/PUBLIC_BASE_URL/);
  });

  it('INFINITEPAY_HANDLE inválido falha', () => {
    expect(() => loadConfig({ ...IP, INFINITEPAY_HANDLE: 'tem espaco' })).toThrow(/INFINITEPAY_HANDLE/);
  });
});

describe('config: túnel no lugar do endereço fixo', () => {
  const base = { EVOLUTION_URL: 'http://e', EVOLUTION_API_KEY: 'k', WEBHOOK_TOKEN: 't', NIM_API_KEY: 'n', PIX_PROVIDER: 'infinitepay', INFINITEPAY_HANDLE: 'fake-handle' };

  test('TUNNEL_METRICS_URL dispensa PUBLIC_BASE_URL', () => {
    const cfg = loadConfig({ ...base, TUNNEL_METRICS_URL: 'http://tunnel:2000/quicktunnel' });
    expect(cfg.infinitepay?.publicBaseUrl).toBeNull();
    expect(cfg.infinitepay?.tunnelMetricsUrl).toBe('http://tunnel:2000/quicktunnel');
  });

  test('sem túnel e sem PUBLIC_BASE_URL, o serviço não sobe', () => {
    expect(() => loadConfig(base)).toThrow(/PUBLIC_BASE_URL/);
  });
});
