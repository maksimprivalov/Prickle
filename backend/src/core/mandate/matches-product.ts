import type { Offer } from '../offers/offer';
import type { Mandate } from './mandate';

/** Is this offer the product the shopper asked for? Category, and screen size when set. */
export function offerMatchesMandate(
  offer: Pick<Offer, 'category' | 'screenInches'>,
  mandate: Pick<Mandate, 'category' | 'screenInches'>,
): boolean {
  if (offer.category.toLowerCase() !== mandate.category.toLowerCase()) return false;
  return mandate.screenInches === undefined || offer.screenInches === mandate.screenInches;
}
