import type { OfferView } from '@features/session';
import { OfferCard } from './offer-card';

export type OffersListProps = { offers: OfferView[]; running: boolean };

export function OffersList({ offers, running }: OffersListProps) {
  return (
    <div aria-busy={running}>
      {offers.length === 0 ? (
        <p className="text-muted">{running ? 'The scouts are searching…' : 'No offers found.'}</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {offers.map((view) => (
            <li key={view.offer.offerId}>
              <OfferCard view={view} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
