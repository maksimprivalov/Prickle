import { formatMoney } from '@lib/format-money';
import type { SessionView } from './reduce-events';

// What the polite live region announces: milestones only, not every event.

const decisionWord = { pass: 'passed', reject: 'was rejected', unverifiable: 'is unverifiable' };

export function storeName(storeId: string): string {
  return `Store ${storeId.toUpperCase()}`;
}

export function milestones(view: SessionView): string[] {
  const out: string[] = [];
  if (view.scoutsStarted > 0) out.push(`${view.scoutsStarted} scouts started`);
  for (const { offer, review } of view.offers) {
    if (review) out.push(`Offer from ${storeName(offer.storeId)} ${decisionWord[review.decision]}`);
  }
  for (const decision of view.guardDecisions) {
    out.push(
      decision.decision.allow
        ? `Guard allowed payment for ${decision.offerId}`
        : `Guard denied payment for ${decision.offerId}`,
    );
  }
  for (const payment of view.payments) {
    out.push(`Payment settled: ${formatMoney(payment.amount, 'USDC')}`);
  }
  if (view.ended) out.push('Session ended');
  return out;
}
