import { z } from 'zod';
import { UsdcUnits } from '../money/money';
import { StoreIdSchema } from '../offers/store-id';
import { RecordId } from '../records/record-id';
import { SourcedCents } from '../records/sourced-amount';
import { eventBase } from './event-base';
import { EventName } from './event-name';

/** An agent asks to pay the checkout total of one offer. The guard decides next. */
export const PaymentRequested = z.object({
  ...eventBase,
  type: z.literal(EventName.PaymentRequested),
  offerId: z.string().min(1),
  storeId: StoreIdSchema,
  /** The checkout total (fees included), citing the checkout breakdown. */
  total: SourcedCents,
});
export type PaymentRequested = z.infer<typeof PaymentRequested>;

export const GuardReasonCode = {
  OverMandate: 'over_mandate',
  UntrustedStore: 'untrusted_store',
  DiscountNotVerified: 'discount_not_verified',
  ProductMismatch: 'product_mismatch',
  InsufficientBalance: 'insufficient_balance',
  MissingVerdict: 'missing_verdict',
  InvalidMandate: 'invalid_mandate',
  GuardError: 'guard_error',
} as const;
export type GuardReasonCode = (typeof GuardReasonCode)[keyof typeof GuardReasonCode];

/**
 * Why the guard denied, with the values it compared, e.g. checkout total €648.00 against the
 * mandate's €600.00, each with its record id. `compared` is empty when no number is involved.
 */
export const GuardReason = z.object({
  code: z.enum(GuardReasonCode),
  message: z.string().min(1),
  compared: z.array(z.object({ label: z.string().min(1), value: SourcedCents })),
  sources: z.array(RecordId),
});
export type GuardReason = z.infer<typeof GuardReason>;

export const GuardDecision = z.discriminatedUnion('allow', [
  z.object({ allow: z.literal(true) }),
  z.object({ allow: z.literal(false), reasons: z.array(GuardReason).min(1) }),
]);
export type GuardDecision = z.infer<typeof GuardDecision>;

/** The guard is code, not an LLM: `agent` is "guard". */
export const GuardDecided = z.object({
  ...eventBase,
  type: z.literal(EventName.GuardDecided),
  offerId: z.string().min(1),
  decision: GuardDecision,
});
export type GuardDecided = z.infer<typeof GuardDecided>;

export const WalletKind = { Mock: 'mock', Devnet: 'devnet' } as const;
export type WalletKind = (typeof WalletKind)[keyof typeof WalletKind];

/**
 * Money moved. `recordId` is the payment's own record in the run, so "spent 585 of 600" cites
 * it. Explorer links are built only for devnet signatures.
 */
export const PaymentSettled = z.object({
  ...eventBase,
  type: z.literal(EventName.PaymentSettled),
  recordId: RecordId,
  offerId: z.string().min(1),
  storeId: StoreIdSchema,
  amount: UsdcUnits,
  /** Spent in this session so far, this payment included. */
  spent: UsdcUnits,
  /** The mandate's cap in test USDC. */
  cap: UsdcUnits,
  wallet: z.enum(WalletKind),
  signature: z.string().min(1),
});
export type PaymentSettled = z.infer<typeof PaymentSettled>;

export const PaymentFailed = z.object({
  ...eventBase,
  type: z.literal(EventName.PaymentFailed),
  offerId: z.string().min(1),
  wallet: z.enum(WalletKind),
  detail: z.string().min(1),
});
export type PaymentFailed = z.infer<typeof PaymentFailed>;
