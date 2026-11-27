import { z } from 'zod';
import type { Offer } from '../offers';
import { RecordId } from '../records';
import { formatEur } from '../money';
import { Checker, ReasonCode, type Verdict } from '../verdicts';
import type { DealCheck } from './omnibus-30-day';

// The deal verifier's verdict. The decision always comes from omnibus30Day (code). The agent
// only writes the explanation, and its explanation is used only when it reached the same
// conclusion as the code; otherwise the code's own wording is used and the disagreement shows.

export const DealConclusion = {
  Real: 'real',
  Fake: 'fake',
  Unverifiable: 'unverifiable',
  NoClaim: 'no_claim',
} as const;
export type DealConclusion = (typeof DealConclusion)[keyof typeof DealConclusion];

/** What the deal-verifier agent answers. */
export const DealExplanation = z.object({
  conclusion: z.enum(DealConclusion),
  /** One or two plain sentences. Every number in it must come from a cited record. */
  text: z.string().min(1),
  sources: z.array(RecordId).min(1),
});
export type DealExplanation = z.infer<typeof DealExplanation>;

const conclusionOf: Record<DealCheck['code'], DealConclusion> = {
  [ReasonCode.RealDiscount]: DealConclusion.Real,
  [ReasonCode.FakeDiscount]: DealConclusion.Fake,
  [ReasonCode.HistoryTooShort]: DealConclusion.Unverifiable,
  [ReasonCode.NoDiscountClaimed]: DealConclusion.NoClaim,
};

/** The code's own explanation, used when the agent failed or disagreed. */
export function explainDealCheck(check: DealCheck): string {
  switch (check.code) {
    case ReasonCode.RealDiscount:
      return (
        `Real discount: the "was" price ${formatEur(check.wasPrice.amount)} is not above the ` +
        `lowest price of the 30 days before the reduction, ${formatEur(check.lowest30.amount)}.`
      );
    case ReasonCode.FakeDiscount:
      return (
        `Fake discount: the "was" price ${formatEur(check.wasPrice.amount)} is above the lowest ` +
        `price of the 30 days before the reduction, ${formatEur(check.lowest30.amount)}.`
      );
    case ReasonCode.HistoryTooShort:
      return 'Cannot verify the discount: the price history does not cover the 30 days before it.';
    case ReasonCode.NoDiscountClaimed:
      return 'The store claims no discount on this offer.';
  }
}

export function dealVerdict(
  offer: Offer,
  check: DealCheck,
  explanation: DealExplanation | undefined,
): Verdict {
  const agrees = explanation?.conclusion === conclusionOf[check.code];
  // The code wins a disagreement: its own wording is used, and the agent's view is kept visible.
  const text = agrees
    ? explanation.text
    : explanation
      ? `${explainDealCheck(check)} (The agent concluded "${explanation.conclusion}"; the 30-day rule in code decides.)`
      : explainDealCheck(check);
  const [first, ...rest] =
    check.code === ReasonCode.FakeDiscount ? [offer.recordId, ...check.lowestRows] : check.sources;
  return {
    offerId: offer.offerId,
    checker: Checker.DealVerifier,
    decision: check.decision,
    reasons: [
      {
        code: check.code,
        text,
        sources: [first ?? offer.recordId, ...rest],
      },
    ],
  };
}

/** True when the agent's conclusion differs from the code's, for the log and the reviewer. */
export function dealDisagreement(check: DealCheck, explanation: DealExplanation): boolean {
  return explanation.conclusion !== conclusionOf[check.code];
}
