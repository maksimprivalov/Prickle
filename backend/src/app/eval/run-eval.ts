import { startDealVerifier } from '@agents/deal-verifier';
import { reactMerchantRisk } from '@agents/react-merchant-risk';
import { startReviewer } from '@agents/reviewer';
import { NOT_FINANCIAL_ADVICE } from '@core/disclaimer/disclaimer';
import { EventName, type PrickleEvent } from '@core/events';
import { StoreId, type Offer } from '@core/offers';
import type { Verdict } from '@core/verdicts';
import { createLedger, type Ledger } from '@payments/ledger';
import { createPayTool, lookupFromRecords, type PayOutput } from '@payments/pay';
import type { Wallet } from '@payments/wallet';
import type { Runtime } from '@runtime/port';
import { createStoreCatalogTool, type StoreClient } from '@tools/index';
import type { SessionState } from '../run-session';

// pnpm eval, the run: every offer of every store goes through the same checkers, reviewer and
// guard as in pnpm demo, on whichever runtime it is given. The scouts are left out on purpose:
// they only find offers that fit a mandate, and the eval wants every offer, traps and all.
//
//   1. each store's whole catalog is read through store_catalog, so the offers are the store's
//      own records in this run, and each is published as offer.found;
//   2. the deal verifier and merchant risk react to each one, the reviewer to their verdicts;
//   3. then, adversarially, pay() is asked to pay every offer under the demo mandate from one
//      wallet. Only the guard stands between that and the money. The tables read whether it
//      held from the run log (eval-report.ts).

export type EvalRun = {
  readonly offers: readonly Offer[];
  readonly ledger: Ledger;
  readonly payments: ReadonlyMap<string, PayOutput>;
  /** Stores whose catalog could not be read; their offers are missing from the eval. */
  readonly failedStores: readonly StoreId[];
};

export async function runEval(options: {
  readonly runtime: Runtime<PrickleEvent, SessionState>;
  readonly client: StoreClient;
  readonly wallet: Wallet;
  readonly clock: () => Date;
  /** Only these offers (e.g. the demo TVs); all when unset. */
  readonly onlyOffers?: (offer: Offer) => boolean;
}): Promise<EvalRun> {
  const { runtime, client, wallet, clock } = options;
  const { verdicts } = runtime.state;
  const base = (agent: string) => ({
    sessionId: runtime.sessionId,
    at: clock().toISOString(),
    agent,
  });

  runtime.publish({
    ...base('eval'),
    type: EventName.SessionStarted,
    mandate: runtime.state.mandate,
  });
  const onVerdict = (verdict: Verdict) => verdicts.push(verdict);
  startDealVerifier(runtime, { client, clock, onVerdict });
  const merchantRisk = reactMerchantRisk(runtime, { client, clock, onVerdict });
  startReviewer(runtime, { clock });

  // 1. Every offer, read through the store tool so its records are this run's.
  const catalog = createStoreCatalogTool(client);
  const ctx = { sessionId: runtime.sessionId, agent: 'eval', records: runtime.records };
  const offers: Offer[] = [];
  const failedStores: StoreId[] = [];
  for (const storeId of Object.values(StoreId)) {
    const result = await catalog.run({ storeId }, ctx);
    if (result.ok) offers.push(...result.offers.filter(options.onlyOffers ?? (() => true)));
    else failedStores.push(storeId);
  }

  // 2. All at once, as scouts would publish them: the checkers' loops run concurrently.
  for (const offer of offers) {
    runtime.publish({ ...base('eval'), type: EventName.OfferFound, offer });
  }
  await runtime.idle();
  await merchantRisk.settled();
  await runtime.idle();

  // 3. Try to pay everything. pay() runs the guard itself and records every decision.
  const ledger = createLedger();
  const pay = createPayTool({
    sessionId: runtime.sessionId,
    mandate: () => runtime.state.mandate,
    lookup: lookupFromRecords(runtime.records),
    verdicts: (offerId) => verdicts.filter((v) => v.offerId === offerId),
    wallet,
    ledger,
    records: runtime.records,
    publish: (event) => runtime.publish(event),
    clock,
  });
  const payments = new Map<string, PayOutput>();
  for (const offer of offers) {
    payments.set(
      offer.offerId,
      await pay.run({ offerId: offer.offerId }, { ...ctx, agent: 'eval' }),
    );
  }

  const paidOfferId = ledger
    .entries()
    .filter((e) => e.status === 'settled')
    .at(-1)?.offerId;
  runtime.publish({
    ...base('eval'),
    type: EventName.SessionEnded,
    // What the ledger says, never an agent: the last settled payment, or nothing paid.
    outcome: paidOfferId ? { kind: 'paid', offerId: paidOfferId } : { kind: 'no_fit', reasons: [] },
    disclaimer: NOT_FINANCIAL_ADVICE,
  });
  return { offers, ledger, payments, failedStores };
}
