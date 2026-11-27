import { EventName, type PrickleEvent } from '@core/events';
import { formatEur, formatUsdc } from '@core/money';

// One line per event for the terminal: time since the session started, who, what, and the
// record each number came from. The start of the `pnpm demo` output format.

const pad = (text: string, width: number) => text.padEnd(width);

function elapsed(at: string, startedAt: number): string {
  const ms = Math.max(0, Date.parse(at) - startedAt);
  return `+${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}s`;
}

function describe(event: PrickleEvent): string {
  switch (event.type) {
    case EventName.SessionStarted:
      return `mandate: ${event.mandate.description}, at most ${formatEur(event.mandate.maxTotal)}`;
    case EventName.ScoutStarted:
      return `searching store ${event.storeId.toUpperCase()}`;
    case EventName.OfferFound: {
      const o = event.offer;
      const was = o.wasPrice === undefined ? '' : ` (was ${formatEur(o.wasPrice)})`;
      return `found  ${o.title}: ${formatEur(o.price)}${was}  [${o.recordId}]`;
    }
    case EventName.ScoutFinished:
      return event.outcome.ok ? 'done' : `FAILED: ${event.outcome.detail}`;
    case EventName.VerdictReady:
      return `${event.verdict.decision} ${event.verdict.offerId}: ${event.verdict.reasons.map((r) => r.code).join(', ')}`;
    case EventName.GroundingRejected:
      return `dropped an answer with unsourced numbers: ${event.unsourcedNumbers.join(', ')}`;
    case EventName.ReviewDone:
      return `review ${event.offerId}: ${event.decision}`;
    case EventName.PaymentRequested:
      return `asks to pay ${formatEur(event.total.amount)} for ${event.offerId}  [${event.total.recordId}]`;
    case EventName.GuardDecided:
      return event.decision.allow
        ? `ALLOW ${event.offerId}`
        : `DENY ${event.offerId}: ${event.decision.reasons.map((r) => r.message).join('; ')}`;
    case EventName.PaymentSettled:
      return `paid ${formatUsdc(event.amount)} (${formatUsdc(event.spent)} of ${formatUsdc(event.cap)} spent)  [${event.recordId}]`;
    case EventName.PaymentFailed:
      return `payment failed for ${event.offerId}: ${event.detail}`;
    case EventName.SessionEnded:
      return `ended: ${event.outcome.kind}. ${event.disclaimer}`;
  }
}

export function formatEvent(event: PrickleEvent, startedAt: number): string {
  return `${pad(elapsed(event.at, startedAt), 7)} ${pad(event.agent, 15)} ${describe(event)}`;
}
