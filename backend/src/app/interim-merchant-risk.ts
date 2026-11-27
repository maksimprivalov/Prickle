import { EventName, type PrickleEvent } from '@core/events';
import type { CheckoutBreakdown, Offer, StoreProfile } from '@core/offers';
import type { Reason, Verdict } from '@core/verdicts';
import type { Runtime } from '@runtime/port';
import { createCheckoutTotalTool, createStoreProfileTool, type StoreClient } from '@tools/index';

// INTERIM, until Tara's merchant-risk agent lands (work-split.md: Tara, Fri 08:30). The guard
// requires a merchant-risk verdict on every offer, so without one nothing could ever be paid.
// This is plain code, no LLM: it reads the checkout and the store profile through the same store
// tools the agent will use, so the records land in the run, and decides the traps the data
// plants. Replace the call in run-session.ts with the agent; delete this file.

const SCARCITY = /\bonly \d+ left\b/i;

export function merchantRiskReasons(
  offer: Offer,
  checkout: CheckoutBreakdown,
  store: StoreProfile,
): { decision: Verdict['decision']; reasons: [Reason, ...Reason[]] } {
  const reasons: Reason[] = [];
  const fee = checkout.lines.find((line) => line.kind === 'service_fee');
  if (fee) {
    reasons.push({
      code: 'hidden_fee',
      text: `A "${fee.label}" is added only at checkout.`,
      sources: [checkout.recordId],
    });
  }
  if (offer.stockLabel !== undefined && SCARCITY.test(offer.stockLabel)) {
    reasons.push({
      code: 'fake_scarcity',
      text: `The listing says "${offer.stockLabel}".`,
      sources: [offer.recordId],
    });
  }
  if (store.returnPolicy.kind !== 'refund') {
    reasons.push({
      code: 'no_refund_policy',
      text: `${store.name} offers no refunds.`,
      sources: [store.recordId],
    });
  }
  if (!store.trusted) {
    reasons.push({
      code: 'untrusted_store',
      text: `${store.name} is not a trusted store.`,
      sources: [store.recordId],
    });
  }
  const [first, ...rest] = reasons;
  return first
    ? { decision: 'reject', reasons: [first, ...rest] }
    : {
        decision: 'pass',
        reasons: [
          {
            code: 'store_looks_sound',
            text: `No checkout-only fees and a refund policy at ${store.name}.`,
            sources: [checkout.recordId, store.recordId],
          },
        ],
      };
}

export function startInterimMerchantRisk<S>(
  runtime: Runtime<PrickleEvent, S>,
  options: {
    readonly client: StoreClient;
    readonly clock: () => Date;
    readonly onVerdict?: (verdict: Verdict) => void;
  },
): { settled(): Promise<void> } {
  const checkoutTool = createCheckoutTotalTool(options.client);
  const profileTool = createStoreProfileTool(options.client);
  const ctx = { sessionId: runtime.sessionId, agent: 'merchant-risk', records: runtime.records };
  const pending = new Set<Promise<void>>();

  async function check(offer: Offer): Promise<void> {
    const [checkoutOut, profileOut] = await Promise.all([
      checkoutTool.run({ storeId: offer.storeId, offerId: offer.offerId }, ctx),
      profileTool.run({ storeId: offer.storeId }, ctx),
    ]);
    // A store failure means no verdict, so the guard denies (missing_verdict): fail closed.
    if (!checkoutOut.ok || !profileOut.ok) return;
    const verdict: Verdict = {
      offerId: offer.offerId,
      checker: 'merchant-risk',
      ...merchantRiskReasons(offer, checkoutOut.checkout, profileOut.store),
    };
    runtime.publish({
      type: EventName.VerdictReady,
      sessionId: runtime.sessionId,
      at: options.clock().toISOString(),
      agent: 'merchant-risk',
      verdict,
    });
    options.onVerdict?.(verdict);
  }

  runtime.observe(EventName.OfferFound, (event) => {
    if (event.type !== EventName.OfferFound) return;
    const job = check(event.offer).catch(() => undefined);
    pending.add(job);
    void job.then(() => pending.delete(job));
  });

  return {
    async settled() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
