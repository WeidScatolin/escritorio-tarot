import { describe, expect, it } from 'vitest';
import { createStore } from '../src/store.js';
import { PLACEHOLDER_CATALOG, formatBRL, getItem } from '../src/catalog.js';
import { createFakePix } from '../src/pix/fake.js';
import { UnknownItemError, confirmPayment, openCharge } from '../src/payments.js';

const JID = '5511999999999@s.whatsapp.net';

function setup() {
  const store = createStore(':memory:');
  const pix = createFakePix();
  return { store, pix, deps: { store, pix } };
}

describe('catalog', () => {
  it('formatBRL formata centavos em reais com espaço comum', () => {
    expect(formatBRL(2900)).toBe('R$ 29,00');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(5)).toBe('R$ 0,05');
  });

  it('catálogo provisório tem preços em centavos inteiros e getItem acha por id', () => {
    expect(PLACEHOLDER_CATALOG.length).toBeGreaterThan(0);
    for (const item of PLACEHOLDER_CATALOG) {
      expect(Number.isInteger(item.priceCents)).toBe(true);
      expect(item.priceCents).toBeGreaterThan(0);
      expect(getItem(item.id)).toEqual(item);
    }
    expect(getItem('nao-existe')).toBeUndefined();
  });
});

describe('fake pix', () => {
  it('gera chargeId único e copia-e-cola marcado como FAKE', async () => {
    const pix = createFakePix();
    const a = await pix.createCharge({ orderId: 'o1', amountCents: 100, description: 'x' });
    const b = await pix.createCharge({ orderId: 'o2', amountCents: 100, description: 'x' });
    expect(a.chargeId).not.toBe(b.chargeId);
    expect(a.copyPaste).toContain('FAKE');
  });
});

describe('openCharge', () => {
  it('cria cobrança pending com o valor do catálogo', async () => {
    const { store, deps } = setup();
    const item = PLACEHOLDER_CATALOG[0]!;
    const charge = await openCharge(deps, JID, item.id);
    expect(charge.status).toBe('pending');
    expect(charge.amountCents).toBe(item.priceCents);
    expect(charge.itemId).toBe(item.id);
    expect(charge.jid).toBe(JID);
    expect(store.getCharge(charge.chargeId)).toEqual(charge);
  });

  it('item inventado lança UnknownItemError e não cria nada', async () => {
    const { store, deps } = setup();
    await expect(openCharge(deps, JID, 'inventado')).rejects.toBeInstanceOf(UnknownItemError);
    expect(store.getCharge('inventado')).toBeNull();
  });
});

describe('confirmPayment', () => {
  it('antes do pagamento retorna pending e a cobrança segue pending', async () => {
    const { store, deps } = setup();
    const charge = await openCharge(deps, JID, PLACEHOLDER_CATALOG[0]!.id);
    expect(await confirmPayment(deps, charge.chargeId)).toBe('pending');
    expect(store.getCharge(charge.chargeId)?.status).toBe('pending');
  });

  it('pagamento com o valor certo vira paid', async () => {
    const { store, pix, deps } = setup();
    const charge = await openCharge(deps, JID, PLACEHOLDER_CATALOG[0]!.id);
    pix.simulatePayment(charge.chargeId);
    expect(await confirmPayment(deps, charge.chargeId)).toBe('paid');
    expect(store.getCharge(charge.chargeId)?.status).toBe('paid');
  });

  it('valor pago diferente do cobrado retorna mismatch e não vira paid', async () => {
    const { store, pix, deps } = setup();
    const charge = await openCharge(deps, JID, PLACEHOLDER_CATALOG[0]!.id);
    pix.simulatePayment(charge.chargeId, charge.amountCents - 1);
    expect(await confirmPayment(deps, charge.chargeId)).toBe('mismatch');
    expect(store.getCharge(charge.chargeId)?.status).not.toBe('paid');
    pix.simulatePayment(charge.chargeId, charge.amountCents + 1);
    expect(await confirmPayment(deps, charge.chargeId)).toBe('mismatch');
    expect(store.getCharge(charge.chargeId)?.status).not.toBe('paid');
  });

  it('chargeId desconhecido retorna unknown', async () => {
    const { deps } = setup();
    expect(await confirmPayment(deps, 'nao-existe')).toBe('unknown');
  });

  it('cobrança já paga continua paid (idempotente)', async () => {
    const { pix, deps } = setup();
    const charge = await openCharge(deps, JID, PLACEHOLDER_CATALOG[0]!.id);
    pix.simulatePayment(charge.chargeId);
    expect(await confirmPayment(deps, charge.chargeId)).toBe('paid');
    expect(await confirmPayment(deps, charge.chargeId)).toBe('paid');
  });
});
