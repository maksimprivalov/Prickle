import type { Offer, PriceHistoryRow } from '../offers';
import type { RecordId, SourcedCents } from '../records';
import { Decision, ReasonCode } from '../verdicts';
import { daysBefore } from './iso-date';

// "Real discount" is decided here, in code, by the EU Omnibus Directive test (Art. 6a): an
// announced reduction must be measured against the lowest price of the 30 days before it. If
// the store's "was" price is above that lowest price, the discount is fake. The deal-verifier
// agent explains this result; it never computes it.

export const OMNIBUS_WINDOW_DAYS = 30;

export type DealCheck =
  /** No "was" price and no reduction date: nothing to verify. Not a real discount either. */
  | {
      readonly decision: typeof Decision.Pass;
      readonly code: typeof ReasonCode.NoDiscountClaimed;
      readonly sources: readonly RecordId[];
    }
  /** Fewer than 30 days of history before the reduction: cannot be called real. */
  | {
      readonly decision: typeof Decision.Unverifiable;
      readonly code: typeof ReasonCode.HistoryTooShort;
      readonly missingDays: readonly string[];
      readonly sources: readonly RecordId[];
    }
  | {
      readonly decision: typeof Decision.Pass | typeof Decision.Reject;
      readonly code: typeof ReasonCode.RealDiscount | typeof ReasonCode.FakeDiscount;
      readonly wasPrice: SourcedCents;
      /** The lowest price in the window, citing the first row at that price. */
      readonly lowest30: SourcedCents;
      /** Every row at the lowest price: the rows that prove the verdict. */
      readonly lowestRows: readonly RecordId[];
      /** The offer record and all 30 window rows. */
      readonly sources: readonly RecordId[];
    };

export function omnibus30Day(offer: Offer, history: readonly PriceHistoryRow[]): DealCheck {
  const { wasPrice, reductionStart } = offer;
  if (wasPrice === undefined || reductionStart === undefined) {
    return {
      decision: Decision.Pass,
      code: ReasonCode.NoDiscountClaimed,
      sources: [offer.recordId],
    };
  }

  const window = daysBefore(reductionStart, OMNIBUS_WINDOW_DAYS);
  const byDate = new Map<string, PriceHistoryRow>();
  for (const row of history) {
    if (row.offerId !== offer.offerId) continue;
    // Two rows for one day: the cheaper one counts, so a lower price can never hide.
    const seen = byDate.get(row.date);
    if (seen === undefined || row.price < seen.price) byDate.set(row.date, row);
  }
  const rows = window.flatMap((day) => byDate.get(day) ?? []);
  const missingDays = window.filter((day) => !byDate.has(day));
  const sources = [offer.recordId, ...rows.map((r) => r.recordId)];

  const [first, ...rest] = rows;
  if (missingDays.length > 0 || first === undefined) {
    return {
      decision: Decision.Unverifiable,
      code: ReasonCode.HistoryTooShort,
      missingDays,
      sources,
    };
  }

  const lowest = rest.reduce((low, row) => (row.price < low.price ? row : low), first);
  // A "was" price at or below today's price claims a reduction that is not there at all.
  const real = wasPrice <= lowest.price && offer.price < wasPrice;
  return {
    decision: real ? Decision.Pass : Decision.Reject,
    code: real ? ReasonCode.RealDiscount : ReasonCode.FakeDiscount,
    wasPrice: { amount: wasPrice, recordId: offer.recordId },
    lowest30: { amount: lowest.price, recordId: lowest.recordId },
    lowestRows: rows.filter((r) => r.price === lowest.price).map((r) => r.recordId),
    sources,
  };
}
