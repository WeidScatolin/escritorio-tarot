import { describe, expect, test } from 'vitest';
import { createTunnelResolver } from '../src/pix/tunnel.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createTunnelResolver', () => {
  test('monta o endereço https a partir do hostname atual do túnel', async () => {
    const calls: string[] = [];
    const resolve = createTunnelResolver({
      metricsUrl: 'http://tunnel:2000/quicktunnel',
      fetchImpl: async (url) => {
        calls.push(String(url));
        return jsonResponse({ hostname: 'abc-def.trycloudflare.com' });
      },
    });
    await expect(resolve()).resolves.toBe('https://abc-def.trycloudflare.com');
    expect(calls).toEqual(['http://tunnel:2000/quicktunnel']);
  });

  test('lê de novo a cada chamada (o endereço muda quando o túnel reinicia)', async () => {
    const hosts = ['um.trycloudflare.com', 'dois.trycloudflare.com'];
    const resolve = createTunnelResolver({
      metricsUrl: 'http://tunnel:2000/quicktunnel',
      fetchImpl: async () => jsonResponse({ hostname: hosts.shift() }),
    });
    await expect(resolve()).resolves.toBe('https://um.trycloudflare.com');
    await expect(resolve()).resolves.toBe('https://dois.trycloudflare.com');
  });

  test('cai para o endereço fixo quando o túnel não responde', async () => {
    const resolve = createTunnelResolver({
      metricsUrl: 'http://tunnel:2000/quicktunnel',
      fallbackBase: 'https://fixo.example.com/',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(resolve()).resolves.toBe('https://fixo.example.com');
  });

  test('sem túnel e sem endereço fixo, falha com erro claro', async () => {
    const resolve = createTunnelResolver({
      metricsUrl: 'http://tunnel:2000/quicktunnel',
      fetchImpl: async () => jsonResponse({}, 404),
    });
    await expect(resolve()).rejects.toThrow(/endereço público/i);
  });

  test('rejeita hostname com formato suspeito', async () => {
    const resolve = createTunnelResolver({
      metricsUrl: 'http://tunnel:2000/quicktunnel',
      fetchImpl: async () => jsonResponse({ hostname: 'evil.com/path?x=1' }),
    });
    await expect(resolve()).rejects.toThrow(/endereço público/i);
  });

  test('sem metricsUrl usa só o endereço fixo', async () => {
    const resolve = createTunnelResolver({ fallbackBase: 'https://fixo.example.com' });
    await expect(resolve()).resolves.toBe('https://fixo.example.com');
  });
});
