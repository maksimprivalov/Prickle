import { z } from 'zod';
import { StoreIdSchema } from '../offers/store-id';
import { RecordId } from '../records/record-id';
import { ReasonCode } from '../verdicts/verdict';

// The eval's answer key: every trap the data generator planted, the offer it sits on, and the
// part of Prickle that must catch it. Written to data/fixtures/traps.json by scripts/gen-data.ts.

/** A trap's name is the reason code its catcher reports when it catches it. */
export const TrapKind = {
  FakeDiscount: ReasonCode.FakeDiscount,
  HiddenFee: ReasonCode.HiddenFee,
  FakeScarcity: ReasonCode.FakeScarcity,
  NoRefundPolicy: ReasonCode.NoRefundPolicy,
  OverBudget: ReasonCode.OverBudget,
} as const;
export type TrapKind = (typeof TrapKind)[keyof typeof TrapKind];

export const Catcher = {
  DealVerifier: 'deal-verifier',
  MerchantRisk: 'merchant-risk',
  MandateGuard: 'mandate-guard',
} as const;
export type Catcher = (typeof Catcher)[keyof typeof Catcher];

export const TrapEntry = z.object({
  trap: z.enum(TrapKind),
  storeId: StoreIdSchema,
  offerId: z.string().min(1),
  expectedCatcher: z.enum(Catcher),
  /** The records that prove the trap; a catcher's verdict should cite them. */
  recordIds: z.array(RecordId).min(1),
});
export type TrapEntry = z.infer<typeof TrapEntry>;
