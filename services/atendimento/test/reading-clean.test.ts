import { describe, expect, it } from 'vitest';
import { cleanReading, plainHistory } from '../src/agent.js';
import { buildServer } from '../src/server.js';
import { agentJson, JID, makeHarness, ok, TOKEN, upsert, type Harness } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;
const PIX = `/webhook/pix/${TOKEN}`;
const LONG = 'Ana, a Rainha de Copas fala de sensibilidade e de escuta ao que você sente neste momento de trabalho. Vale olhar com calma para o que importa de verdade.';

describe('cleanReading', () => {
  it('devolve o texto normal sem mexer', () => {
    expect(cleanReading(LONG)).toBe(LONG);
  });

  it('extrai o texto quando o modelo respondeu em JSON', () => {
    expect(cleanReading(JSON.stringify({ reply: LONG, action: { kind: 'none' } }))).toBe(LONG);
  });

  it('tira cerca de código ao redor do JSON', () => {
    expect(cleanReading('```json\n' + JSON.stringify({ reply: LONG }) + '\n```')).toBe(LONG);
  });

  it('rejeita JSON cortado (resposta incompleta)', () => {
    expect(cleanReading('{"reply":"Ana, a Rainha')).toBe('');
  });

  it('rejeita resposta curta demais para ser uma leitura', () => {
    expect(cleanReading('Ok.')).toBe('');
    expect(cleanReading('   ')).toBe('');
  });

  it('rejeita JSON sem texto utilizável', () => {
    expect(cleanReading('{"action":{"kind":"none"}}')).toBe('');
  });
});

describe('plainHistory', () => {
  it('troca o JSON do assistente pelo texto da resposta e mantém o do cliente', () => {
    const out = plainHistory([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: JSON.stringify({ reply: 'Qual o seu nome?', action: { kind: 'none' } }) },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Qual o seu nome?' },
    ]);
  });

  it('mantém o conteúdo quando não é JSON', () => {
    expect(plainHistory([{ role: 'assistant', content: 'texto puro' }])).toEqual([{ role: 'assistant', content: 'texto puro' }]);
  });
});

async function payAndDeliver(h: Harness) {
  const app = buildServer(h.deps);
  await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm1', text: 'quero a de 3 cartas', ad: true }) });
  await app.settled();
  const chargeId = h.store.getConversation(JID)!.openChargeId!;
  const before = h.sent.length;
  h.pix.simulatePayment(chargeId);
  await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
  await app.settled();
  return h.sent.slice(before).map((m) => m.text).join('\n');
}

const CHARGE = agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' });

describe('entrega da leitura', () => {
  it('manda ao modelo o histórico em texto puro (sem JSON) e pede só o texto da leitura', async () => {
    const h = makeHarness({ llm: [CHARGE, ok(LONG)] });
    await payAndDeliver(h);
    const reading = h.llmCalls.at(-1)!;
    expect(reading.system).toMatch(/sem JSON/i);
    for (const m of reading.messages) expect(m.content).not.toContain('"reply"');
  });

  it('se o modelo devolver JSON com a leitura, entrega só o texto', async () => {
    const h = makeHarness({ llm: [CHARGE, ok(JSON.stringify({ reply: LONG, action: { kind: 'none' } }))] });
    const text = await payAndDeliver(h);
    expect(text).toContain(LONG);
    expect(text).not.toContain('"reply"');
  });

  it('tenta de novo uma vez quando a primeira resposta vem cortada', async () => {
    const h = makeHarness({ llm: [CHARGE, ok('{"reply":"Ana, a Rainha'), ok(LONG)] });
    const text = await payAndDeliver(h);
    expect(text).toContain(LONG);
    expect(h.llmCalls).toHaveLength(3);
  });

  it('se as duas tentativas falharem, nunca manda lixo: avisa que a interpretação segue em instantes', async () => {
    const h = makeHarness({ llm: [CHARGE, ok('{"reply":"Ana, a Rainha'), ok('{"reply":"Ana, a Rainha')] });
    const text = await payAndDeliver(h);
    expect(text).not.toContain('"reply"');
    expect(text).toMatch(/instantes/i);
  });
});
