import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { CARDS } from '../src/tarot.js';
import { agentJson, JID, makeHarness, ok, TOKEN, upsert, type Harness } from './helpers.js';

const EVO = `/webhook/evolution/${TOKEN}`;
const PIX = `/webhook/pix/${TOKEN}`;
const script = [agentJson('Segue o Pix!', { kind: 'charge', itemId: 'tiragem-intermediaria' }), ok('Uma leitura bonita.')];

function assets(opts: { shuffling: boolean; missing?: number[] }): string {
  const dir = mkdtempSync(join(tmpdir(), 'assets-'));
  mkdirSync(join(dir, 'cards'));
  CARDS.forEach((_, i) => {
    if (!opts.missing?.includes(i)) writeFileSync(join(dir, 'cards', `${String(i).padStart(2, '0')}.jpg`), 'img');
  });
  if (opts.shuffling) writeFileSync(join(dir, 'shuffling.jpg'), 'img');
  return dir;
}

async function payAndDeliver(h: Harness) {
  const app = buildServer(h.deps);
  await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm1', text: 'quero a de 3 cartas', ad: true }) });
  await app.settled();
  const chargeId = h.store.getConversation(JID)!.openChargeId!;
  h.sent.length = 0;
  h.sentMedia.length = 0;
  h.order.length = 0;
  h.pix.simulatePayment(chargeId);
  await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
  await app.settled();
  return { app, chargeId };
}

describe('entrega com imagens', () => {
  it('manda embaralhando, depois cada carta com a posição na legenda, depois o texto da leitura', async () => {
    const h = makeHarness({ llm: script });
    h.deps.assetsDir = assets({ shuffling: true });
    const { chargeId } = await payAndDeliver(h);

    const cards = h.store.getCharge(chargeId)!.cards!;
    const idx = cards.map((c) => String(CARDS.indexOf(c)).padStart(2, '0') + '.jpg');
    expect(h.order.slice(0, 4)).toEqual(['media:shuffling.jpg', ...idx.map((f) => `media:${f}`)]);
    expect(h.order.slice(4).every((o) => o === 'text')).toBe(true);
    expect(h.sentMedia[1]!.caption).toBe(`Passado — ${cards[0]}`);
    expect(h.sentMedia[3]!.caption).toBe(`Futuro — ${cards[2]}`);
    expect(h.sent.map((m) => m.text).join('\n')).toContain('Uma leitura bonita.');
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
  });

  it('sem shuffling.jpg: pula e segue com as cartas', async () => {
    const h = makeHarness({ llm: script });
    h.deps.assetsDir = assets({ shuffling: false });
    await payAndDeliver(h);
    expect(h.sentMedia).toHaveLength(3);
    expect(h.sentMedia.some((m) => m.fileName === 'shuffling.jpg')).toBe(false);
  });

  it('imagem de uma carta faltando: as outras vão, e o texto lista todas as cartas', async () => {
    const h = makeHarness({ llm: script });
    h.deps.assetsDir = assets({ shuffling: true, missing: Array.from({ length: 78 }, (_, i) => i) });
    const { chargeId } = await payAndDeliver(h);
    const cards = h.store.getCharge(chargeId)!.cards!;
    expect(h.sentMedia.map((m) => m.fileName)).toEqual(['shuffling.jpg']);
    for (const card of cards) expect(h.sent.map((m) => m.text).join('\n')).toContain(card);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
  });

  it('envio de imagem falha: cai para texto e entrega mesmo assim', async () => {
    const h = makeHarness({ llm: script });
    h.deps.assetsDir = assets({ shuffling: true });
    h.flags.mediaFails = true;
    const { chargeId } = await payAndDeliver(h);
    const cards = h.store.getCharge(chargeId)!.cards!;
    expect(h.sentMedia).toHaveLength(0);
    for (const card of cards) expect(h.sent.map((m) => m.text).join('\n')).toContain(card);
    expect(h.sent.map((m) => m.text).join('\n')).toContain('Uma leitura bonita.');
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
  });

  it('sem assetsDir configurado: só texto, como antes', async () => {
    const h = makeHarness({ llm: script });
    await payAndDeliver(h);
    expect(h.sentMedia).toHaveLength(0);
    expect(h.sent.length).toBeGreaterThan(0);
  });

  it('reentrega (texto falhou na 1ª vez) usa as mesmas cartas nas imagens', async () => {
    const h = makeHarness({ llm: script });
    h.deps.assetsDir = assets({ shuffling: false });
    const app = buildServer(h.deps);
    await app.inject({ method: 'POST', url: EVO, payload: upsert({ id: 'm1', text: 'quero a de 3 cartas', ad: true }) });
    await app.settled();
    const chargeId = h.store.getConversation(JID)!.openChargeId!;
    h.pix.simulatePayment(chargeId);
    h.flags.sendFails = true;
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();
    const first = h.sentMedia.map((m) => m.fileName);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(false);

    h.flags.sendFails = false;
    h.sentMedia.length = 0;
    await app.inject({ method: 'POST', url: PIX, payload: { chargeId } });
    await app.settled();
    expect(h.sentMedia.map((m) => m.fileName)).toEqual(first);
    expect(h.store.getCharge(chargeId)!.delivered).toBe(true);
  });
});
