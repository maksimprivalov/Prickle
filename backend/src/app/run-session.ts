import { budgetMessage, createBudgetAgent, type Candidate } from '@agents/budget';
import { startDealVerifier } from '@agents/deal-verifier';
import { startScouts, type ScoutRun } from '@agents/start-scouts';
import { NOT_FINANCIAL_ADVICE } from '@core/disclaimer/disclaimer';
import {
  EventName,
  GuardReasonCode,
  type GuardReason,
  type PrickleEvent,
  type SessionOutcome,
} from '@core/events';
import type { Mandate } from '@core/mandate';
import { CheckoutBreakdown, type Offer } from '@core/offers';
import type { Reason, ReasonCode, Verdict } from '@core/verdicts';
import { createLedger, type Ledger } from '@payments/ledger';
import { createGuardInterceptor, createPayTool, lookupFromRecords } from '@payments/pay';
import type { Wallet } from '@payments/wallet';
import type { Runtime } from '@runtime/port';
import type { StoreClient } from '@tools/index';
import { startInterimMerchantRisk } from './interim-merchant-risk';

// One shopping session, on whichever runtime adapter it is given:
//   1. five scouts start together; each offer.found wakes the deal verifier and merchant risk,
//      which check it while the other scouts are still searching;
//   2. when everything has settled, the budget agent pays the cheapest offer that passed, through
//      pay(), which the mandate guard protects twice (interception, then inside pay());
//   3. session.ended says what happened, with the disclaimer.

export type SessionState = {
  /** As the user set it. The guard reads it from here, never from agent output. */
  readonly mandate: Mandate;
  readonly verdicts: Verdict[];
};

export type SessionResult = {
  readonly outcome: SessionOutcome;
  readonly ledger: Ledger;
  readonly scouts: readonly ScoutRun[];
  readonly verdicts: readonly Verdict[];
};

const guardToReason: Partial<Record<GuardReason['code'], ReasonCode>> = {
  [GuardReasonCode.OverMandate]: 'over_budget',
  [GuardReasonCode.UntrustedStore]: 'untrusted_store',
  [GuardReasonCode.DiscountNotVerified]: 'fake_discount',
};

function checkoutOf(runtime: Runtime<PrickleEvent, SessionState>, offerId: string) {
  return runtime.records.all().flatMap((record) => {
    const parsed = CheckoutBreakdown.safeParse(record);
    return parsed.success && parsed.data.offerId === offerId ? [parsed.data] : [];
  })[0];
}

/** Why the best offer falls outside the mandate: the checkers' rejections and the guard's. */
function whyNot(
  offer: Offer,
  verdicts: readonly Verdict[],
  guard: readonly GuardReason[],
): Reason[] {
  const fromCheckers = verdicts
    .filter((v) => v.offerId === offer.offerId && v.decision !== 'pass')
    .flatMap((v) => v.reasons);
  const fromGuard = guard.flatMap((r): Reason[] => {
    const code = guardToReason[r.code];
    const [first, ...rest] = r.sources;
    return code ? [{ code, text: r.message, sources: [first ?? offer.recordId, ...rest] }] : [];
  });
  return [...fromCheckers, ...fromGuard];
}

export async function runSession(options: {
  readonly runtime: Runtime<PrickleEvent, SessionState>;
  readonly client: StoreClient;
  readonly wallet: Wallet;
  readonly clock: () => Date;
}): Promise<SessionResult> {
  const { runtime, client, wallet, clock } = options;
  const { mandate, verdicts } = runtime.state;
  const base = (agent: string) => ({
    sessionId: runtime.sessionId,
    at: clock().toISOString(),
    agent,
  });
  const ledger = createLedger();
  const guardDenials = new Map<string, GuardReason[]>();
  runtime.observe(EventName.GuardDecided, (event) => {
    if (event.type === EventName.GuardDecided && !event.decision.allow) {
      guardDenials.set(event.offerId, event.decision.reasons);
    }
  });

  const end = (outcome: SessionOutcome): SessionResult => {
    runtime.publish({
      ...base('app'),
      type: EventName.SessionEnded,
      outcome,
      disclaimer: NOT_FINANCIAL_ADVICE,
    });
    return { outcome, ledger, scouts, verdicts };
  };

  runtime.publish({ ...base('app'), type: EventName.SessionStarted, mandate });

  // The checkers react to offers as they appear; nobody calls them.
  const onVerdict = (verdict: Verdict) => verdicts.push(verdict);
  startDealVerifier(runtime, { client, clock, onVerdict });
  const merchantRisk = startInterimMerchantRisk(runtime, { client, clock, onVerdict });

  const paySession = {
    sessionId: runtime.sessionId,
    mandate: () => runtime.state.mandate,
    lookup: lookupFromRecords(runtime.records),
    verdicts: (offerId: string) => verdicts.filter((v) => v.offerId === offerId),
    wallet,
    ledger,
    records: runtime.records,
    publish: (event: PrickleEvent) => runtime.publish(event),
    clock,
  };
  runtime.intercept(createGuardInterceptor(paySession));

  const scouts = await startScouts(runtime, { mandate, client, clock });
  await runtime.idle();
  await merchantRisk.settled();
  await runtime.idle();

  const offers = scouts.flatMap((run) => run.offers);
  if (offers.length === 0) {
    const failed = scouts.filter((run) => !run.result.ok).length;
    return end(
      failed === scouts.length
        ? { kind: 'failed', detail: 'every scout failed; see scout.finished events' }
        : { kind: 'no_fit', reasons: [] },
    );
  }

  const candidates: Candidate[] = offers.map((offer) => ({
    offer,
    checkout: checkoutOf(runtime, offer.offerId),
    verdicts: verdicts.filter((v) => v.offerId === offer.offerId),
  }));
  const budget = createBudgetAgent(createPayTool(paySession));
  const answer = await runtime.start(budget, budgetMessage(mandate, candidates)).done;
  await runtime.idle();

  // What happened is read from the ledger, never from the agent's answer.
  const paid = ledger.entries().find((entry) => entry.status === 'settled');
  if (paid) return end({ kind: 'paid', offerId: paid.offerId });
  if (!answer.ok && ledger.entries().length === 0) {
    return end({ kind: 'failed', detail: `the budget agent failed: ${answer.detail}` });
  }

  // The best option: fewest checker objections first, then the lowest checkout total.
  const objections = (c: Candidate) => c.verdicts.filter((v) => v.decision !== 'pass').length;
  const ranked = [...candidates].sort(
    (a, b) =>
      objections(a) - objections(b) ||
      (a.checkout?.total ?? Infinity) - (b.checkout?.total ?? Infinity),
  );
  const best = ranked[0]?.offer;
  return end({
    kind: 'no_fit',
    ...(best ? { bestOfferId: best.offerId } : {}),
    reasons: best ? whyNot(best, verdicts, guardDenials.get(best.offerId) ?? []) : [],
  });
}
