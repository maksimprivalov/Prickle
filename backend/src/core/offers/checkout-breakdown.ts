import { z } from 'zod';
import { Cents } from '../money/money';
import { RecordId } from '../records/record-id';

export const CheckoutLineKind = {
  Item: 'item',
  Shipping: 'shipping',
  ServiceFee: 'service_fee',
  Tax: 'tax',
} as const;
export type CheckoutLineKind = (typeof CheckoutLineKind)[keyof typeof CheckoutLineKind];

export const CheckoutLine = z.object({
  kind: z.enum(CheckoutLineKind),
  /** As the store labels it, e.g. "Service fee". */
  label: z.string().min(1),
  amount: Cents,
});
export type CheckoutLine = z.infer<typeof CheckoutLine>;

/**
 * What the store charges at checkout. `total` is stated by the store, not summed by us: the
 * guard pays against this number, and a hidden fee shows up as a line the listing never had.
 */
export const CheckoutBreakdown = z.object({
  recordId: RecordId,
  offerId: z.string().min(1),
  lines: z.array(CheckoutLine).min(1),
  total: Cents,
});
export type CheckoutBreakdown = z.infer<typeof CheckoutBreakdown>;
