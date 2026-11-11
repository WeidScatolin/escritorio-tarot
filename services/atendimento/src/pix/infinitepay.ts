// Pix real pelo Checkout Integrado da InfinitePay (https://www.infinitepay.io/checkout-documentacao).
// A API cria um LINK de pagamento hospedado: o código Pix/QR só aparece na tela da cliente.
// Por isso `copyPaste` carrega o link. Confirmação: sempre por POST /payment_check (o webhook não é assinado).
import type { PaymentProof, PixProvider } from './provider.js';

export class InfinitePayError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InfinitePayError';
  }
}

export type InfinitePayOptions = {
  handle: string;
  /** Chave `inchk_...` (opcional). Nunca entra em mensagens de erro nem em logs. */
  apiKey: string | null;
  webhookUrl: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = 'https://api.checkout.infinitepay.io';
const DEFAULT_TIMEOUT_MS = 8000;
// O nome do campo do link não é documentado: leitura tolerante.
const LINK_FIELDS = ['url', 'link', 'checkout_url', 'payment_url'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function findLink(body: unknown): string | null {
  const levels = isRecord(body) ? [body, ...(isRecord(body.data) ? [body.data] : [])] : [];
  for (const level of levels) {
    for (const field of LINK_FIELDS) {
      const value = level[field];
      if (typeof value === 'string' && value.startsWith('https://')) return value;
    }
  }
  return null;
}

export function createInfinitePay(opts: InfinitePayOptions): PixProvider {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;

  // Mensagens de erro nunca carregam a chave nem o corpo da resposta (que pode ecoá-la).
  async function post(path: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.apiKey) headers['X-Api-Key'] = opts.apiKey;
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new InfinitePayError(`InfinitePay ${path}: falha de rede`);
    }
    if (!response.ok) throw new InfinitePayError(`InfinitePay ${path}: HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new InfinitePayError(`InfinitePay ${path}: resposta não é JSON`);
    }
  }

  return {
    kind: 'link',

    async createCharge({ orderId, amountCents, description }) {
      const body: Record<string, unknown> = {
        handle: opts.handle,
        order_nsu: orderId,
        webhook_url: opts.webhookUrl,
        items: [{ quantity: 1, price: amountCents, description }],
      };
      if (opts.apiKey) {
        body.options = { payment_methods_enabled: ['credit_card', 'pix'], single_payment: true };
      }
      const link = findLink(await post('/links', body));
      if (!link) throw new InfinitePayError('InfinitePay /links: a resposta não trouxe o link de pagamento (campo não reconhecido)');
      return { chargeId: orderId, copyPaste: link };
    },

    async verifyPaid(chargeId: string, proof?: PaymentProof) {
      const notPaid = { paid: false, paidCents: 0 };
      if (!proof) return notPaid;
      const result = await post('/payment_check', {
        handle: opts.handle,
        order_nsu: chargeId,
        transaction_nsu: proof.transactionNsu,
        slug: proof.slug,
      });
      if (!isRecord(result) || result.success !== true || result.paid !== true) return notPaid;
      const { amount, paid_amount: paidAmount } = result;
      if (typeof amount !== 'number' || typeof paidAmount !== 'number') return notPaid;
      // Cartão parcelado pode somar juros em paid_amount: vale o valor do pedido, desde que ao menos ele tenha sido pago.
      return { paid: true, paidCents: Math.min(amount, paidAmount) };
    },
  };
}
