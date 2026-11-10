import { describe, expect, it } from 'vitest';
import { confirmPayment, openCharge } from '../src/payments.js';
import { createFakePix } from '../src/pix/fake.js';
import { createStore } from '../src/store.js';

const JID = 'a@s.whatsapp.net';

describe('confirmPayment grava o horário do pagamento (paidAtMs)', () => {
  it('usa o relógio informado em deps.now', async () => {
    const store = createStore(':memory:');
    const pix = createFakePix();
    const charge = await openCharge({ store, pix }, JID, 'tiragem-3-cartas');
    pix.simulatePayment(charge.chargeId);

    expect(await confirmPayment({ store, pix, now: () => 1_234_567 }, charge.chargeId)).toBe('paid');

    expect(store.getCharge(charge.chargeId)!.paidAtMs).toBe(1_234_567);
  });

  it('sem deps.now, usa a hora real (número positivo)', async () => {
    const store = createStore(':memory:');
    const pix = createFakePix();
    const charge = await openCharge({ store, pix }, JID, 'tiragem-3-cartas');
    pix.simulatePayment(charge.chargeId);

    await confirmPayment({ store, pix }, charge.chargeId);

    expect(store.getCharge(charge.chargeId)!.paidAtMs).toBeGreaterThan(1_700_000_000_000);
  });

  it('valor diferente (mismatch) não grava horário', async () => {
    const store = createStore(':memory:');
    const pix = createFakePix();
    const charge = await openCharge({ store, pix }, JID, 'tiragem-3-cartas');
    pix.simulatePayment(charge.chargeId, 100);

    expect(await confirmPayment({ store, pix, now: () => 5 }, charge.chargeId)).toBe('mismatch');

    expect(store.getCharge(charge.chargeId)!.paidAtMs).toBeNull();
  });

  it('chamar de novo numa cobrança já paga não muda o horário original', async () => {
    const store = createStore(':memory:');
    const pix = createFakePix();
    const charge = await openCharge({ store, pix }, JID, 'tiragem-3-cartas');
    pix.simulatePayment(charge.chargeId);

    await confirmPayment({ store, pix, now: () => 111 }, charge.chargeId);
    await confirmPayment({ store, pix, now: () => 999 }, charge.chargeId);

    expect(store.getCharge(charge.chargeId)!.paidAtMs).toBe(111);
  });
});
