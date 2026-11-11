import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const BASE = { EVOLUTION_URL: 'http://e', EVOLUTION_API_KEY: 'k', WEBHOOK_TOKEN: 't', NIM_API_KEY: 'n' };

describe('config da publicação na Vercel', () => {
  it('fica desligada quando nada é configurado', () => {
    expect(loadConfig(BASE).publish).toBeNull();
  });

  it('liga com URL e segredo, intervalo padrão de 60 s', () => {
    const c = loadConfig({ ...BASE, PUBLISH_URL: 'https://x.vercel.app/api/push', PUBLISH_SECRET: 's' });
    expect(c.publish).toEqual({ url: 'https://x.vercel.app/api/push', secret: 's', intervalSeconds: 60 });
  });

  it('é tudo ou nada e sem citar o segredo', () => {
    expect(() => loadConfig({ ...BASE, PUBLISH_SECRET: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE, PUBLISH_SECRET: 'abc' })).toThrow(/PUBLISH_URL/);
  });

  it('recusa URL que não seja https', () => {
    expect(() => loadConfig({ ...BASE, PUBLISH_URL: 'http://x/api/push', PUBLISH_SECRET: 's' })).toThrow(/https/);
  });
});
