import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';

// Task 8 amplia este tipo com store, llm, pix e evolution (ver ledger: Ruling do pre-flight).
export type ServerDeps = Partial<{ config: Config }>;

export function buildServer(_deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
