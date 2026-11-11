import { beforeEach, describe, expect, it } from 'vitest';
import { deliverReading, type AgentDeps } from '../src/agent.js';
import { CATALOG, getItem } from '../src/catalog.js';
import { confirmPayment, openCharge } from '../src/payments.js';
import { createFakePix } from '../src/pix/fake.js';
import { createStore } from '../src/store.js';
import type { LlmClient } from '../src/llm/nim.js';

const JID = '5511900000000@s.whatsapp.net';
const llm: LlmClient = { async complete() { return { kind: 'ok', text: 'Leitura.' }; } };

let store: ReturnType<typeof createStore>;
let pix: ReturnType<typeof createFakePix>;
const deps = (): AgentDeps => ({ llm, store, pix, now: () => 1_700_000_000 });

beforeEach(() => {
  store = createStore(':memory:');
  pix = createFakePix();
});

async function buy(jid: string, itemId: string): Promise<string[]> {
  const charge = await openCharge({ store, pix }, jid, itemId);
  pix.simulatePayment(charge.chargeId);
  await confirmPayment({ store, pix }, charge.chargeId);
  await deliverReading(deps(), charge.chargeId);
  return store.getCharge(charge.chargeId)!.cards!;
}

describe('catálogo das três tiragens', () => {
  it('tem R$ 15, R$ 25 e R$ 35 com 1, 3 e 5 cartas', () => {
    expect(CATALOG.map((i) => [i.priceCents, i.cardCount])).toEqual([[1500, 1], [2500, 3], [3500, 5]]);
  });

  it('cada item tem uma posição por carta', () => {
    for (const item of CATALOG) expect(item.positions).toHaveLength(item.cardCount);
  });
});

describe('sorteio por tiragem', () => {
  it.each(CATALOG.map((i) => [i.id, i.cardCount] as const))('%s sorteia %i carta(s)', async (id, count) => {
    expect(await buy(JID, id)).toHaveLength(count);
  });

  it('o mesmo cliente comprando várias vezes nunca recebe carta repetida', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      for (const card of await buy(JID, 'tiragem-completa')) {
        expect(seen.has(card)).toBe(false);
        seen.add(card);
      }
    }
  });

  it('clientes diferentes sorteiam de forma independente (histórico de um não afeta o outro)', async () => {
    await buy(JID, 'tiragem-completa');
    expect(store.previousDraws('outro@s.whatsapp.net', 'x')).toEqual([]);
  });

  it('o cabeçalho mostra a posição de cada carta', async () => {
    const charge = await openCharge({ store, pix }, JID, 'tiragem-intermediaria');
    pix.simulatePayment(charge.chargeId);
    await confirmPayment({ store, pix }, charge.chargeId);
    const text = (await deliverReading(deps(), charge.chargeId)).join('\n');
    for (const pos of getItem('tiragem-intermediaria')!.positions) expect(text).toContain(pos);
  });
});
