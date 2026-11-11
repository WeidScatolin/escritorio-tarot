import { describe, expect, it } from 'vitest';
import { openCharge } from '../src/payments.js';
import { createFakePix } from '../src/pix/fake.js';
import { createStore } from '../src/store.js';

describe('openCharge e o código copia e cola', () => {
  it('devolve o copyPaste gerado pelo provedor junto com a cobrança', async () => {
    const store = createStore(':memory:');
    const pix = createFakePix();

    const charge = await openCharge({ store, pix }, 'a@s.whatsapp.net', 'tiragem-intermediaria');

    expect(charge.copyPaste).toContain('FAKE');
    expect(charge.copyPaste).toContain(charge.chargeId);
    expect(charge.amountCents).toBe(2500);
  });

  it('grava o copyPaste no banco para poder reenviar o Pix se o envio falhar', async () => {
    const store = createStore(':memory:');
    const pix = createFakePix();

    const charge = await openCharge({ store, pix }, 'a@s.whatsapp.net', 'tiragem-intermediaria');

    expect(store.getCharge(charge.chargeId)).toEqual(charge);
    expect(store.getCharge(charge.chargeId)!.copyPaste).toBe(charge.copyPaste);
  });
});
