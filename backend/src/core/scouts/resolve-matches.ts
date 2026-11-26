import { offerMatchesMandate } from '../mandate/matches-product';
import type { Mandate } from '../mandate/mandate';
import { Offer } from '../offers/offer';
import type { StoreId } from '../offers/store-id';

// Turns the record ids a scout named into offers, in code. The scout only points; this decides
// what is published as offer.found. Pure: the record lookup is passed in.

export const DropReason = {
  NotReturned: 'not_returned_by_a_tool',
  NotAnOffer: 'not_an_offer',
  OtherStore: 'from_another_store',
  OtherProduct: 'not_the_mandate_product',
} as const;
export type DropReason = (typeof DropReason)[keyof typeof DropReason];

export type ResolvedMatches = {
  readonly offers: Offer[];
  readonly dropped: { readonly recordId: string; readonly reason: DropReason }[];
};

export function resolveMatches(input: {
  readonly recordIds: readonly string[];
  readonly lookup: (recordId: string) => unknown;
  readonly storeId: StoreId;
  readonly mandate: Pick<Mandate, 'category' | 'screenInches'>;
}): ResolvedMatches {
  const offers: Offer[] = [];
  const dropped: { recordId: string; reason: DropReason }[] = [];
  for (const recordId of new Set(input.recordIds)) {
    const record = input.lookup(recordId);
    if (record === undefined) {
      dropped.push({ recordId, reason: DropReason.NotReturned });
      continue;
    }
    const parsed = Offer.safeParse(record);
    if (!parsed.success) {
      dropped.push({ recordId, reason: DropReason.NotAnOffer });
    } else if (parsed.data.storeId !== input.storeId) {
      dropped.push({ recordId, reason: DropReason.OtherStore });
    } else if (!offerMatchesMandate(parsed.data, input.mandate)) {
      dropped.push({ recordId, reason: DropReason.OtherProduct });
    } else {
      offers.push(parsed.data);
    }
  }
  return { offers, dropped };
}
