import { BudgetAnswer } from '@core/budget/budget-answer';
import type { Mandate } from '@core/mandate';
import type { Offer, CheckoutBreakdown } from '@core/offers';
import type { Verdict } from '@core/verdicts';
import { ModelTier, defineAgent, type ToolSpec } from '@runtime/port';

// The budget agent: given the checked offers, it pays the cheapest one that passed every check,
// through pay(). It never chooses an amount: pay() takes only an offer id, and the mandate guard
// (interception in front of pay(), and again inside it) decides whether money may move.

export function createBudgetAgent(payTool: ToolSpec) {
  return defineAgent({
    name: 'budget',
    prompt: 'budget.md',
    model: ModelTier.Strong,
    tools: [payTool],
    output: BudgetAnswer,
  });
}

export type Candidate = {
  readonly offer: Offer;
  readonly checkout: CheckoutBreakdown | undefined;
  readonly verdicts: readonly Verdict[];
};

/** The message the budget loop starts with: the mandate and every candidate with its records. */
export function budgetMessage(mandate: Mandate, candidates: readonly Candidate[]): string {
  return JSON.stringify({
    mandate,
    candidates: candidates.map(({ offer, checkout, verdicts }) => ({
      offerId: offer.offerId,
      title: offer.title,
      storeId: offer.storeId,
      listPrice: { amount: offer.price, recordId: offer.recordId },
      checkoutTotal: checkout ? { amount: checkout.total, recordId: checkout.recordId } : null,
      verdicts: verdicts.map((v) => ({
        checker: v.checker,
        decision: v.decision,
        reasons: v.reasons.map((r) => r.code),
      })),
    })),
  });
}
