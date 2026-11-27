import { z } from 'zod';
import { omnibus30Day } from '@core/deal/omnibus-30-day';
import { Offer, PriceHistoryRow } from '@core/offers';
import type { ModelDriver } from '@runtime/plain/plain-runtime';

// `pnpm eval --scripted`: a stand-in for the LLM on the plain runtime, for when there is no
// key or no quota. It does what each prompt asks, the way a careful model would: calls the
// same tools with the same inputs and names the records they returned. It writes no
// explanations of its own, so the verdicts carry the code's wording.
//
// What this measures: the tools, the code that decides (30-day rule, core/risk, review, guard)
// and the wiring between them. What it does not: whether the real model picks the right tools.
// The live run (`pnpm eval`) measures that.

const RecordRef = z.object({ recordId: z.string() });
const DealMessage = z.object({ recordId: z.string(), offerId: z.string(), storeId: z.string() });
const ReviewMessage = z.object({
  verdicts: z.array(z.object({ reasons: z.array(z.object({ sources: z.array(z.string()) })) })),
});

/** The offer line of a merchant-risk message: "Offer: {...}". */
const offerIn = (message: string) =>
  Offer.parse(JSON.parse((message.split('\n')[0] ?? '').replace(/^Offer: /, '')));

export const scriptedModel: ModelDriver = async ({ agent, message, callTool }) => {
  switch (agent.name) {
    case 'deal-verifier': {
      const ask = DealMessage.parse(JSON.parse(message));
      const history = z
        .object({ rows: z.array(PriceHistoryRow).default([]) })
        .parse(await callTool('price_history', { storeId: ask.storeId, offerId: ask.offerId }));
      // Reads the rows as a careful model would; the verdict is still computed by the code.
      // The message carries the price fields only; the 30-day rule reads nothing else.
      const offer = Offer.parse({
        ...z.record(z.string(), z.unknown()).parse(JSON.parse(message)),
        title: '(from the deal-verifier message)',
        category: '(from the deal-verifier message)',
      });
      const check = omnibus30Day(offer, history.rows);
      const conclusion = {
        real_discount: 'real',
        fake_discount: 'fake',
        history_too_short: 'unverifiable',
        no_discount_claimed: 'no_claim',
      }[check.code];
      return {
        conclusion,
        text: 'The 30-day rule in code decides; see the cited rows.',
        sources: [ask.recordId],
      };
    }
    case 'merchant-risk': {
      const { storeId, offerId } = offerIn(message);
      const [checkout, store, catalog] = await Promise.all([
        callTool('checkout_total', { storeId, offerId }),
        callTool('store_profile', { storeId }),
        callTool('store_catalog', { storeId }),
      ]);
      return {
        checkout: z.object({ checkout: RecordRef }).parse(checkout).checkout.recordId,
        store: z.object({ store: RecordRef }).parse(store).store.recordId,
        storeOffers: z
          .object({ offers: z.array(RecordRef).default([]) })
          .parse(catalog)
          .offers.map((o) => o.recordId),
        explanations: [],
      };
    }
    case 'reviewer': {
      const { verdicts } = ReviewMessage.parse(JSON.parse(message));
      const sources = verdicts.flatMap((v) => v.reasons.flatMap((r) => r.sources)).slice(0, 1);
      return { text: 'The review rule in code resolved the two checkers.', sources };
    }
    default:
      throw new Error(`the scripted model has no script for ${agent.name}`);
  }
};
