export type PixProvider = {
  createCharge(i: {
    orderId: string;
    amountCents: number;
    description: string;
  }): Promise<{ chargeId: string; copyPaste: string }>;
  verifyPaid(chargeId: string): Promise<{ paid: boolean; paidCents: number }>;
};
