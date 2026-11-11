import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { agentJson, JID, makeHarness, ok, TOKEN, upsert, type Harness } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;
const PIX = `/webhook/pix/${TOKEN}`;
const script = [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' }), ok('Uma leitura bonita.')];
const TTS_ON = { tts: { voice: 'pt-BR-FranciscaNeural' } };

async function payAndDeliver(h: Harness) {
  const app = buildServer(h.deps);
  await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm1', text: 'quero a de 3 cartas', ad: true }) });
  await app.settled();
  const chargeId = h.store.getConversation(JID)!.openChargeId!;
  const before = h.sent.length;
  h.pix.simulatePayment(chargeId);
  await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
  await app.settled();
  return { chargeId, delivered: h.sent.slice(before) };
}

describe('entrega da leitura em áudio (TTS)', () => {
  it('desligado por padrão: tudo em texto, nenhum áudio', async () => {
    const h = makeHarness({ llm: script });
    const { delivered } = await payAndDeliver(h);
    expect(h.audioSent).toHaveLength(0);
    expect(delivered.map((m) => m.text).join('\n')).toContain('Uma leitura bonita.');
  });

  it('ligado: cartas em texto e interpretação como nota de voz (sem repetir em texto)', async () => {
    const h = makeHarness({ llm: script, config: TTS_ON });
    const { chargeId, delivered } = await payAndDeliver(h);

    expect(h.audioSent).toHaveLength(1);
    expect(h.audioSent[0]!.jid).toBe(JID);
    expect(h.audioSent[0]!.delayMs).toBeGreaterThan(0);
    expect(h.tts.texts).toEqual(['Uma leitura bonita.']);
    const text = delivered.map((m) => m.text).join('\n');
    expect(text).toContain('Suas cartas');
    expect(text).not.toContain('Uma leitura bonita.');
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
  });

  it('TTS falha: cai para a interpretação em texto e a entrega conclui', async () => {
    const h = makeHarness({ llm: script, config: TTS_ON });
    h.tts.setFail(true);
    const { chargeId, delivered } = await payAndDeliver(h);

    expect(h.audioSent).toHaveLength(0);
    expect(delivered.map((m) => m.text).join('\n')).toContain('Uma leitura bonita.');
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
    expect(h.notices.some((n) => n.includes('áudio'))).toBe(true);
  });

  it('envio do áudio falha: cai para texto, sem vazar a apikey no aviso', async () => {
    const h = makeHarness({ llm: script, config: TTS_ON });
    h.flags.audioFails = true;
    const { chargeId, delivered } = await payAndDeliver(h);

    expect(delivered.map((m) => m.text).join('\n')).toContain('Uma leitura bonita.');
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
    expect(h.notices.join('\n')).not.toContain('evo-secret-key');
  });

  it('respeita o limite de mensagens por minuto também para o áudio', async () => {
    const h = makeHarness({ llm: script, config: { ...TTS_ON, maxMsgsPerMinuteChat: 2 } });
    await payAndDeliver(h);
    // 1 resposta do Pix (+ possivelmente mais) já usou vagas: o áudio precisou esperar pela janela.
    expect(h.audioSent).toHaveLength(1);
    expect(h.sleeps.some((ms) => ms > 0)).toBe(true);
  });
});
