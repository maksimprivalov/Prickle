import type { PrickleEvent } from '@core/events';
import { EventName } from '@core/events';
import type { Offer } from '@core/offers';
import { resolveMerchantRisk, type MerchantRiskReport, type ResolvedRisk } from '@core/risk';
import type { ReasonCode, Verdict } from '@core/verdicts';
import type { Runtime } from '@runtime/port';
import {
  createCheckoutTotalTool,
  createStoreCatalogTool,
  createStoreProfileTool,
  type StoreClient,
} from '@tools/index';
import { createMerchantRisk, merchantRiskMessage } from './merchant-risk';

// Registers merchant risk as a situation handler: a loop starts for each offer.found as it
// appears, while the scouts are still running, and its verdict is published as verdict.ready.
// Uses only the runtime port, so it runs the same on Mozaik and on the plain adapter.
//
// The decision is code (core/risk), so it does not need the model: when the agent fails (a 429
// from the free LLM tier) or names records that do not fit, the same tools are called directly
// and the same code decides, with plain fallback texts. Only when the store itself fails is
// there no verdict, and then the guard denies (missing verdict): fail closed.

export type MerchantRiskNotice =
  /** The agent's answer was not used; the verdict came from the tools called directly. */
  | { readonly kind: 'fallback'; readonly offerId: string; readonly detail: string }
  /** No verdict at all: the store's tools failed too. */
  | { readonly kind: 'no_verdict'; readonly offerId: string; readonly detail: string }
  /** The agent claimed risks the code did not find (or missed ones it did): words dropped. */
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
    readonly onVerdict?: (verdict: Verdict) => void;
    /** For the terminal or the eval; the run log already has the loop's own outcome. */
    readonly onNotice?: (notice: MerchantRiskNotice) => void;
  },
): { settled(): Promise<void> } {
  const { client, clock, onVerdict, onNotice } = options;
  const agent = createMerchantRisk(client);
  const pending = new Set<Promise<void>>();

  function publish(resolved: Extract<ResolvedRisk, { ok: true }>, offerId: string): void {
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
    onVerdict?.(resolved.verdict);
  }

  /** What the agent would have gathered, gathered by code. */
  async function gatherDirectly(offer: Offer): Promise<MerchantRiskReport | string> {
    const ctx = { sessionId: runtime.sessionId, agent: agent.name, records: runtime.records };
    const { storeId, offerId } = offer;
    const [checkout, store, catalog] = await Promise.all([
      createCheckoutTotalTool(client).run({ storeId, offerId }, ctx),
      createStoreProfileTool(client).run({ storeId }, ctx),
      createStoreCatalogTool(client).run({ storeId }, ctx),
    ]);
    if (!checkout.ok) return `checkout_total failed: ${checkout.reason}`;
    if (!store.ok) return `store_profile failed: ${store.reason}`;
    return {
      checkout: checkout.checkout.recordId,
      store: store.store.recordId,
      // Without the catalog, fake scarcity cannot be shown; the other checks still run.
      storeOffers: catalog.ok ? catalog.offers.map((o) => o.recordId) : [],
      explanations: [],
    };
  }

  async function fallback(offer: Offer, why: string): Promise<void> {
    const report = await gatherDirectly(offer);
    const resolved =
      typeof report === 'string'
        ? ({ ok: false, detail: report } as const)
        : resolveMerchantRisk({ offer, report, lookup: (id) => runtime.records.get(id) });
    if (!resolved.ok) {
      onNotice?.({ kind: 'no_verdict', offerId: offer.offerId, detail: resolved.detail });
      return;
    }
    onNotice?.({ kind: 'fallback', offerId: offer.offerId, detail: why });
    publish(resolved, offer.offerId);
  }

  runtime.react(agent, EventName.OfferFound, {
    message: (event) => merchantRiskMessage(event.offer),
    done: (result, event) => {
      const { offer } = event;
      const resolved = result.ok
        ? resolveMerchantRisk({
            offer,
            report: result.output,
            lookup: (id) => runtime.records.get(id),
          })
        : ({ ok: false, detail: `${result.reason}: ${result.detail}` } as const);
      if (resolved.ok) {
        publish(resolved, offer.offerId);
        return;
      }
      // A thrown store call still must not leave the offer hanging: fail closed, say why.
      const job = fallback(offer, resolved.detail).catch((error: unknown) => {
        onNotice?.({ kind: 'no_verdict', offerId: offer.offerId, detail: String(error) });
      });
      pending.add(job);
      void job.then(() => pending.delete(job));
    },
  });

  return {
    async settled() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
