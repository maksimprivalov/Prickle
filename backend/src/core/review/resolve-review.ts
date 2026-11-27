import { z } from 'zod';
import { RecordId } from '../records';
import { Checker, Decision, type Reason, type Verdict } from '../verdicts';

// The reviewer's decision on one offer, in code (fix 4b). When the checkers disagree, the
// stricter verdict wins: any reject rejects, otherwise any unverifiable is unverifiable,
// otherwise it passes. The reviewer agent explains the resolution; it does not make it.

export const REVIEWED_CHECKERS = [Checker.DealVerifier, Checker.MerchantRisk] as const;

export const REVIEW_RULE =
  'Any reject rejects the offer; otherwise any unverifiable makes it unverifiable; otherwise it passes.';

export type ResolvedReview = {
  readonly offerId: string;
  readonly decision: Decision;
  /** The reasons of the verdicts that decided it, never empty. */
  readonly reasons: readonly [Reason, ...Reason[]];
  /** Present only when the checkers did not all decide the same. */
  readonly disagreement?: readonly { checker: Checker; decision: Decision }[];
};

const strictness: Record<Decision, number> = {
  [Decision.Reject]: 2,
  [Decision.Unverifiable]: 1,
  [Decision.Pass]: 0,
};

/** Undefined until every reviewed checker has a verdict on this offer. */
export function resolveReview(
  offerId: string,
  verdicts: readonly Verdict[],
): ResolvedReview | undefined {
  const latest = new Map<Checker, Verdict>();
  for (const v of verdicts) if (v.offerId === offerId) latest.set(v.checker, v);
  const reviewed = REVIEWED_CHECKERS.flatMap((checker) => {
    const verdict = latest.get(checker);
    return verdict ? [verdict] : [];
  });
  if (reviewed.length < REVIEWED_CHECKERS.length) return undefined;

  const decision = reviewed.reduce<Decision>(
    (worst, v) => (strictness[v.decision] > strictness[worst] ? v.decision : worst),
    Decision.Pass,
  );
  const [first, ...rest] = reviewed
    .filter((v) => v.decision === decision)
    .flatMap((v) => v.reasons);
  // Every verdict has at least one reason, and at least one verdict has the winning decision.
  if (!first) throw new Error(`no reasons for ${offerId}`);
  const decisions = new Set(reviewed.map((v) => v.decision));
  return {
    offerId,
    decision,
    reasons: [first, ...rest],
    ...(decisions.size > 1
      ? { disagreement: reviewed.map((v) => ({ checker: v.checker, decision: v.decision })) }
      : {}),
  };
}

/** What the reviewer agent answers: its explanation of the resolution, with sources. */
export const ReviewExplanation = z.object({
  /** One or two plain sentences; every number must come from a cited record. */
  text: z.string().min(1),
  sources: z.array(RecordId).min(1),
});
export type ReviewExplanation = z.infer<typeof ReviewExplanation>;

/** The code's own wording, used when the agent failed or its answer was dropped. */
export function explainReview(review: ResolvedReview): string {
  const codes = review.reasons.map((r) => r.code.replaceAll('_', ' ')).join(', ');
  if (!review.disagreement) {
    return `Both checkers agree: ${review.decision} (${codes}).`;
  }
  const deciders = review.disagreement
    .filter((d) => d.decision === review.decision)
    .map((d) => d.checker)
    .join(' and ');
  return `The checkers disagree; ${deciders} found ${codes}, so the offer is ${review.decision}.`;
}

/** The review.done reasons: the reviewer's summary first, then the deciding checker reasons. */
export function reviewReasons(
  review: ResolvedReview,
  explanation: ReviewExplanation | undefined,
): [Reason, ...Reason[]] {
  const [first] = review.reasons;
  const summary: Reason = {
    code: first.code,
    text: explanation?.text ?? explainReview(review),
    sources: explanation
      ? [...explanation.sources]
      : [...new Set(review.reasons.flatMap((r) => r.sources))],
  };
  return [summary, ...review.reasons];
}
