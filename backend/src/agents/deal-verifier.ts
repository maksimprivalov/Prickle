import { dealVerdict, DealExplanation } from '@core/deal/deal-verdict';
import { omnibus30Day } from '@core/deal/omnibus-30-day';
import { EventName, type PrickleEvent } from '@core/events';
import { PriceHistoryRow, type Offer } from '@core/offers';
import type { Verdict } from '@core/verdicts';
import { ModelTier, defineAgent, type RecordRegistry, type Runtime } from '@runtime/port';
import { createPriceHistoryTool, type StoreClient } from '@tools/index';

// The deal verifier reacts to every offer.found as it appears (a situation handler, nobody
// calls it). The agent fetches the price history and explains it; the decision is the EU
// 30-day rule computed in code from the very rows the tool returned.

export function createDealVerifier(client: StoreClient) {
  return defineAgent({
    name: 'deal-verifier',
    prompt: 'deal-verifier.md',
    model: ModelTier.Strong,
    tools: [createPriceHistoryTool(client)],
    output: DealExplanation,
  });
}

export function dealVerifierMessage(offer: Offer): string {
  const { recordId, offerId, storeId, price, wasPrice, reductionStart } = offer;
  return JSON.stringify({ recordId, offerId, storeId, price, wasPrice, reductionStart });
}

function historyFor(records: RecordRegistry, offerId: string): PriceHistoryRow[] {
  return records.all().flatMap((record) => {
    const row = PriceHistoryRow.safeParse(record);
    return row.success && row.data.offerId === offerId ? [row.data] : [];
  });
}

/** Registers the deal verifier on offer.found. Each verdict is published as verdict.ready. */
export function startDealVerifier<S>(
  runtime: Runtime<PrickleEvent, S>,
  options: {
    readonly client: StoreClient;
    readonly clock: () => Date;
    readonly onVerdict?: (verdict: Verdict) => void;
  },
): void {
  const agent = createDealVerifier(options.client);
  runtime.react(agent, EventName.OfferFound, {
    message: (event) => dealVerifierMessage(event.offer),
    done: (result, event) => {
      const check = omnibus30Day(event.offer, historyFor(runtime.records, event.offer.offerId));
      const verdict = dealVerdict(event.offer, check, result.ok ? result.output : undefined);
      runtime.publish({
        type: EventName.VerdictReady,
        sessionId: runtime.sessionId,
        at: options.clock().toISOString(),
        agent: agent.name,
        verdict,
      });
      options.onVerdict?.(verdict);
    },
  });
}
