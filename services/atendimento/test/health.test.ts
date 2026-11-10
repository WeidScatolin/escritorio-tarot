import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { makeHarness } from './helpers.js';

describe('GET /health', () => {
  it('responde 200 com status ok', async () => {
    const app = buildServer(makeHarness().deps);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
