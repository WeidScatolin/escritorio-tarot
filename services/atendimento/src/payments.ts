import { randomUUID } from 'node:crypto';
import { getItem } from './catalog.js';
import type { PaymentProof, PixProvider } from './pix/provider.js';
import type { Charge, Store } from './store.js';

type Deps = { store: Store; pix: PixProvider; now?: () => number };

export class UnknownItemError extends Error {
  constructor(itemId: string) {
    super(`item desconhecido: ${itemId}`);
    this.name = 'UnknownItemError';
  }
}

// O copyPaste (código Pix ou link de pagamento) é gravado junto da cobrança para poder reenviá-lo.
export type OpenedCharge = Charge & { copyPaste: string };

export async function openCharge(deps: Deps, jid: string, itemId: string): Promise<OpenedCharge> {
  const item = getItem(itemId);
  if (!item) throw new UnknownItemError(itemId);

  const created = await deps.pix.createCharge({
    orderId: randomUUID(),
    amountCents: item.priceCents,
    description: item.name,
  });
  const charge: OpenedCharge = {
    chargeId: created.chargeId,
    jid,
    itemId: item.id,
    amountCents: item.priceCents,
    status: 'pending',
    cards: null,
    copyPaste: created.copyPaste,
    delivered: false,
    paidAtMs: null,
  };
  deps.store.saveCharge(charge);
  return charge;
}

export async function confirmPayment(
  deps: Deps,
  chargeId: string,
  proof?: PaymentProof,
): Promise<'paid' | 'pending' | 'mismatch' | 'unknown'> {
  const charge = deps.store.getCharge(chargeId);
  if (!charge) return 'unknown';
  if (charge.status === 'paid') return 'paid';

  // Comprovante novo (do webhook) ou o já guardado; só é gravado depois de o provedor confirmar.
  const usedProof =
    proof ?? (charge.transactionNsu && charge.slug ? { transactionNsu: charge.transactionNsu, slug: charge.slug } : undefined);
  const result = await deps.pix.verifyPaid(chargeId, usedProof);
  if (!result.paid) return 'pending';
  if (result.paidCents !== charge.amountCents) return 'mismatch';

  deps.store.saveCharge({
    ...charge,
    status: 'paid',
    paidAtMs: (deps.now ?? Date.now)(),
    ...(usedProof ? { transactionNsu: usedProof.transactionNsu, slug: usedProof.slug } : {}),
  });
  return 'paid';
}
