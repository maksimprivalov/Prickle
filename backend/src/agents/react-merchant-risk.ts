import type { PrickleEvent } from '@core/events';
import { EventName } from '@core/events';
import { resolveMerchantRisk } from '@core/risk';
import type { ReasonCode } from '@core/verdicts';
import type { Runtime } from '@runtime/port';
import type { StoreClient } from '@tools/index';
import { createMerchantRisk, merchantRiskMessage } from './merchant-risk';

// Registers merchant risk as a situation handler: a loop starts for each offer.found as it
// appears, while the scouts are still running, and its verdict is published as verdict.ready.
// Uses only the runtime port, so it runs the same on Mozaik and on the plain adapter.

/** Why no verdict was published for an offer, or what the agent claimed that code dropped. */
export type MerchantRiskNotice =
  | { readonly kind: 'no_verdict'; readonly offerId: string; readonly detail: string }
  | {
      readonly kind: 'unconfirmed';
      readonly offerId: string;
      readonly codes: readonly ReasonCode[];
    };

export function reactMerchantRisk<S>(
  runtime: Runtime<PrickleEvent, S>,
  options: {
    readonly client: StoreClient;
    readonly clock: () => Date;
    /** For the terminal or the eval; the run log already has the loop's own outcome. */
    readonly onNotice?: (notice: MerchantRiskNotice) => void;
  },
): void {
  const { client, clock, onNotice } = options;
  const agent = createMerchantRisk(client);

  runtime.react(agent, EventName.OfferFound, {
    message: (event) => merchantRiskMessage(event.offer),
    done: (result, event) => {
      const { offerId } = event.offer;
      if (!result.ok) {
        onNotice?.({ kind: 'no_verdict', offerId, detail: `${result.reason}: ${result.detail}` });
        return;
      }
      const resolved = resolveMerchantRisk({
        offer: event.offer,
        report: result.output,
        lookup: (id) => runtime.records.get(id),
      });
      if (!resolved.ok) {
        onNotice?.({ kind: 'no_verdict', offerId, detail: resolved.detail });
        return;
      }
      if (resolved.unconfirmed.length > 0) {
        onNotice?.({ kind: 'unconfirmed', offerId, codes: resolved.unconfirmed });
      }
      runtime.publish({
        sessionId: runtime.sessionId,
        at: clock().toISOString(),
        agent: agent.name,
        type: EventName.VerdictReady,
        verdict: resolved.verdict,
      });
    },
  });
}
