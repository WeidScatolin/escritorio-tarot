import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { agentJson, makeHarness, TOKEN } from './helpers.js';

function fixture(name: string): object {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as object;
}

async function replay(name: string) {
  const h = makeHarness({ llm: [agentJson('Olá! Posso te ajudar com uma tiragem?')] });
  const app = buildServer(h.deps);
  const response = await app.inject({ method: 'POST', url: `/webhook/evolution/${TOKEN}`, payload: fixture(name) });
  await app.settled();
  return { h, response };
}

// Fumaça de integração: fixtures (formato ASSUMIDO) -> parser -> filtro -> agente -> envio.
describe('smoke: fixtures pelas rotas', () => {
  it('lead vindo de anúncio recebe resposta', async () => {
    const { h, response } = await replay('ad-referral');
    expect(response.statusCode).toBe(200);
    expect(h.sent).toHaveLength(1);
  });

  it('contato pessoal (sem anúncio) não recebe resposta nem chama a IA', async () => {
    const { h, response } = await replay('text-simple');
    expect(response.statusCode).toBe(200);
    expect(h.sent).toHaveLength(0);
    expect(h.llmCalls).toHaveLength(0);
  });

  it('mensagem em grupo é ignorada', async () => {
    const { h } = await replay('group');
    expect(h.sent).toHaveLength(0);
    expect(h.llmCalls).toHaveLength(0);
  });

  it('áudio sem anúncio é ignorado', async () => {
    const { h } = await replay('audio');
    expect(h.sent).toHaveLength(0);
  });

  it('evento que não é mensagem é ignorado sem erro', async () => {
    const { h, response } = await replay('other-event');
    expect(response.statusCode).toBe(200);
    expect(h.llmCalls).toHaveLength(0);
  });
});
