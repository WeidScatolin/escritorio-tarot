/** Comprovante do webhook do provedor (InfinitePay): necessário para consultar o pagamento. */
export type PaymentProof = { transactionNsu: string; slug: string };

export type PixProvider = {
  /**
   * Como a cliente paga: 'copy_paste' (código Pix copia e cola) ou 'link' (página de pagamento hospedada).
   * Ausente = 'copy_paste'.
   */
  readonly kind?: 'copy_paste' | 'link';
  /** Em `copyPaste` vai o código Pix ou, quando kind = 'link', o link de pagamento. */
  createCharge(i: {
    orderId: string;
    amountCents: number;
    description: string;
  }): Promise<{ chargeId: string; copyPaste: string }>;
  verifyPaid(chargeId: string, proof?: PaymentProof): Promise<{ paid: boolean; paidCents: number }>;
};
