import { CheckoutBreakdown, Offer, StoreProfile } from '../offers';
import { Checker, Verdict, type ReasonCode } from '../verdicts';
import { merchantRisk } from './merchant-risk';
import type { MerchantRiskReport } from './merchant-risk-report';

// Turns the agent's report into a verdict, in code. The agent only points at records; this
// looks them up as the tools returned them, runs merchantRisk on them and keeps the agent's
// words only where the code agrees. Pure: the record lookup is passed in.

/** Used when the agent gave no explanation for a finding the code made. No numbers in them. */
const FALLBACK_TEXT: Readonly<Record<ReasonCode, string>> = {
  real_discount: 'The discount is real.',
  fake_discount: 'The discount is not real.',
  history_too_short: 'The price history is too short to check the discount.',
  no_discount_claimed: 'No discount is claimed.',
  hidden_fee: 'The checkout adds a service fee that the listing does not show.',
  fake_scarcity: 'Every product in this store shows the same low-stock warning.',
  no_refund_policy: 'This store offers no refunds.',
  untrusted_store: 'This store is not on the trusted list.',
  store_looks_sound: 'No hidden fee, refund problem or pressure tactic found at this store.',
  within_budget: 'Within budget.',
  over_budget: 'Over budget.',
};

export type ResolvedRisk =
  | {
      readonly ok: true;
      readonly verdict: Verdict;
      /** Codes the agent explained but the code did not find: dropped, worth logging. */
      readonly unconfirmed: readonly ReasonCode[];
    }
  | { readonly ok: false; readonly detail: string };

export function resolveMerchantRisk(input: {
  readonly offer: Offer;
  readonly report: MerchantRiskReport;
  readonly lookup: (recordId: string) => unknown;
}): ResolvedRisk {
  const { offer, report, lookup } = input;

  const checkout = CheckoutBreakdown.safeParse(lookup(report.checkout));
  if (!checkout.success || checkout.data.offerId !== offer.offerId) {
    return { ok: false, detail: `${report.checkout} is not a checkout of ${offer.offerId}` };
  }
  const store = StoreProfile.safeParse(lookup(report.store));
  if (!store.success || store.data.storeId !== offer.storeId) {
    return { ok: false, detail: `${report.store} is not the profile of store ${offer.storeId}` };
  }
  // A record id no tool returned, or one that is not an offer, is ignored rather than trusted.
  const storeOffers = report.storeOffers.flatMap((id) => {
    const parsed = Offer.safeParse(lookup(id));
    return parsed.success ? [parsed.data] : [];
  });

  const check = merchantRisk({
    offer,
    checkout: checkout.data,
    store: store.data,
    storeOffers,
  });
  const findings =
    check.decision === 'reject' ? check.findings : [{ code: check.code, sources: check.sources }];

  const said = new Map(report.explanations.map((e) => [e.code, e.text]));
  const verdict = Verdict.parse({
    offerId: offer.offerId,
    checker: Checker.MerchantRisk,
    decision: check.decision,
    reasons: findings.map((f) => ({
      code: f.code,
      text: said.get(f.code) ?? FALLBACK_TEXT[f.code],
      sources: f.sources,
    })),
  });
  const found = new Set<ReasonCode>(findings.map((f) => f.code));
  const unconfirmed = report.explanations.map((e) => e.code).filter((code) => !found.has(code));
  return { ok: true, verdict, unconfirmed };
}
