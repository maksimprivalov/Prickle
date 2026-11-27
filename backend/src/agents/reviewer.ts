import { EventName, type PrickleEvent, type ReviewDone } from '@core/events';
import {
  REVIEW_RULE,
  ReviewExplanation,
  resolveReview,
  reviewReasons,
  type ResolvedReview,
} from '@core/review/resolve-review';
import type { Verdict } from '@core/verdicts';
import { ModelTier, defineAgent, type Runtime } from '@runtime/port';

// The reviewer reacts to the other agents' answers (verdict.ready), not to a call: once both
// checkers have judged an offer, it starts. The decision is resolved in code (stricter verdict
// wins); the agent explains it, and its explanation goes through number grounding. Every review,
// and every disagreement, is published as review.done.

export function createReviewer() {
  return defineAgent({
    name: 'reviewer',
    prompt: 'reviewer.md',
    model: ModelTier.Strong,
    tools: [],
    output: ReviewExplanation,
  });
}

export function reviewerMessage(review: ResolvedReview, verdicts: readonly Verdict[]): string {
  return JSON.stringify({
    offerId: review.offerId,
    verdicts: verdicts.filter((v) => v.offerId === review.offerId),
    finalDecision: review.decision,
    rule: REVIEW_RULE,
    ...(review.disagreement ? { disagreement: review.disagreement } : {}),
  });
}

export function startReviewer<S>(
  runtime: Runtime<PrickleEvent, S>,
  options: {
    readonly clock: () => Date;
    readonly onReview?: (review: ReviewDone) => void;
  },
): void {
  const agent = createReviewer();
  const seen: Verdict[] = [];
  const reviewed = new Set<string>();
  const pending = new Map<string, ResolvedReview>();

  runtime.react(agent, EventName.VerdictReady, {
    message: (event) => {
      seen.push(event.verdict);
      const { offerId } = event.verdict;
      if (reviewed.has(offerId)) return undefined;
      const review = resolveReview(offerId, seen);
      if (!review) return undefined;
      reviewed.add(offerId);
      pending.set(offerId, review);
      return reviewerMessage(review, seen);
    },
    done: (result, event) => {
      const review = pending.get(event.verdict.offerId);
      if (!review) return;
      pending.delete(review.offerId);
      const published: ReviewDone = {
        type: EventName.ReviewDone,
        sessionId: runtime.sessionId,
        at: options.clock().toISOString(),
        agent: agent.name,
        offerId: review.offerId,
        decision: review.decision,
        // A failed or dropped answer leaves the code's own wording.
        reasons: reviewReasons(review, result.ok ? result.output : undefined),
        ...(review.disagreement ? { disagreement: [...review.disagreement] } : {}),
      };
      runtime.publish(published);
      options.onReview?.(published);
    },
  });
}
