import { z } from 'zod';
import { RecordId } from '../records/record-id';

export const Checker = {
  DealVerifier: 'deal-verifier',
  MerchantRisk: 'merchant-risk',
  Budget: 'budget',
} as const;
export type Checker = (typeof Checker)[keyof typeof Checker];

export const Decision = { Pass: 'pass', Reject: 'reject', Unverifiable: 'unverifiable' } as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

/** Adding a code is a contract change: the frontend and the eval read them. */
export const ReasonCode = {
  RealDiscount: 'real_discount',
  FakeDiscount: 'fake_discount',
  HistoryTooShort: 'history_too_short',
  NoDiscountClaimed: 'no_discount_claimed',
  HiddenFee: 'hidden_fee',
  FakeScarcity: 'fake_scarcity',
  NoRefundPolicy: 'no_refund_policy',
  UntrustedStore: 'untrusted_store',
  StoreLooksSound: 'store_looks_sound',
  WithinBudget: 'within_budget',
  OverBudget: 'over_budget',
} as const;
export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode];

/** One finding. A reason that cites no record is not a reason, so `sources` is never empty. */
export const Reason = z.object({
  code: z.enum(ReasonCode),
  /** The agent's explanation in plain words; every number in it is checked by core/grounding. */
  text: z.string().min(1),
  sources: z.array(RecordId).min(1),
});
export type Reason = z.infer<typeof Reason>;

export const Verdict = z.object({
  offerId: z.string().min(1),
  checker: z.enum(Checker),
  decision: z.enum(Decision),
  reasons: z.array(Reason).min(1),
});
export type Verdict = z.infer<typeof Verdict>;
