import type { CheckoutBreakdown, Offer, StoreProfile } from '../offers';
import type { RecordId } from '../records';
import { Decision, ReasonCode } from '../verdicts';

// Merchant risk is decided here, in code: hidden fees from the checkout breakdown, fake
// scarcity from the store's stock labels, missing refund policy and untrusted store from the
// store profile. The merchant-risk agent gathers these records and explains the result; it
// never decides it.

/** A low-stock claim as stores word it: "Only 2 left!", "only 1 left in stock". */
const LOW_STOCK_CLAIM = /\bonly\s+\d+\s+left\b/i;

/**
 * Fake scarcity needs a pattern, not one label: the same low-stock claim on every product of
 * the store. With fewer offers than this, one "only 2 left" may well be true.
 */
export const SCARCITY_MIN_OFFERS = 3;

export type RiskCode =
  | typeof ReasonCode.HiddenFee
  | typeof ReasonCode.FakeScarcity
  | typeof ReasonCode.NoRefundPolicy
  | typeof ReasonCode.UntrustedStore;

export type RiskFinding = { readonly code: RiskCode; readonly sources: readonly RecordId[] };

export type RiskCheck =
  | {
      readonly decision: typeof Decision.Reject;
      /** Never empty. */
      readonly findings: readonly RiskFinding[];
    }
  | {
      readonly decision: typeof Decision.Pass;
      readonly code: typeof ReasonCode.StoreLooksSound;
      readonly sources: readonly RecordId[];
    };

export type RiskInput = {
  readonly offer: Offer;
  readonly checkout: CheckoutBreakdown;
  readonly store: StoreProfile;
  /** Every offer of the same store the agent looked at; empty if it listed none. */
  readonly storeOffers: readonly Offer[];
};

export function merchantRisk({ offer, checkout, store, storeOffers }: RiskInput): RiskCheck {
  const findings: RiskFinding[] = [];

  // A charge the listing never showed. Shipping and tax are named on listings; a service fee
  // only appears at checkout.
  if (checkout.lines.some((line) => line.kind === 'service_fee' && line.amount > 0)) {
    findings.push({ code: ReasonCode.HiddenFee, sources: [offer.recordId, checkout.recordId] });
  }

  const label = offer.stockLabel?.trim();
  if (label !== undefined && LOW_STOCK_CLAIM.test(label)) {
    const others = storeOffers.filter(
      (o) => o.storeId === offer.storeId && o.offerId !== offer.offerId,
    );
    const all = [offer, ...others];
    if (all.length >= SCARCITY_MIN_OFFERS && all.every((o) => o.stockLabel?.trim() === label)) {
      findings.push({ code: ReasonCode.FakeScarcity, sources: all.map((o) => o.recordId) });
    }
  }

  if (store.returnPolicy.kind !== 'refund') {
    findings.push({ code: ReasonCode.NoRefundPolicy, sources: [store.recordId] });
  }

  if (!store.trusted) {
    findings.push({ code: ReasonCode.UntrustedStore, sources: [store.recordId] });
  }

  if (findings.length > 0) return { decision: Decision.Reject, findings };
  return {
    decision: Decision.Pass,
    code: ReasonCode.StoreLooksSound,
    sources: [offer.recordId, checkout.recordId, store.recordId],
  };
}
