import { randomUUID } from 'node:crypto';
import type { PixProvider } from './provider.js';

export function createFakePix(): PixProvider & {
  simulatePayment(chargeId: string, cents?: number): void;
} {
  const charges = new Map<string, { amountCents: number; paidCents: number | null }>();

  return {
    async createCharge({ amountCents }) {
      const chargeId = `fake_${randomUUID()}`;
      charges.set(chargeId, { amountCents, paidCents: null });
      const copyPaste = `00020126FAKE0014BR.GOV.BCB.PIX${chargeId}5303986540${amountCents}5802BR6304FAKE`;
      return { chargeId, copyPaste };
    },

    async verifyPaid(chargeId) {
      const c = charges.get(chargeId);
      if (!c || c.paidCents === null) return { paid: false, paidCents: 0 };
      return { paid: true, paidCents: c.paidCents };
    },

    simulatePayment(chargeId, cents) {
      const c = charges.get(chargeId);
      if (!c) throw new Error(`cobrança Pix falsa inexistente: ${chargeId}`);
      c.paidCents = cents ?? c.amountCents;
    },
  };
}
