import { Money } from '@components/money';
import { SourceRef } from '@components/source-ref';
import { storeName, type OfferView } from '@features/session';
import { DecisionBadge } from './decision-badge';
import { GroundingNote } from './grounding-note';
import { ReasonList } from './reason-list';

export type OfferCardProps = { view: OfferView };

export function OfferCard({ view }: OfferCardProps) {
  const { offer, verdicts, review, groundingRejections } = view;
  return (
    <article
      aria-labelledby={`offer-${offer.offerId}`}
      className="rounded-lg border border-line p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={`offer-${offer.offerId}`} className="text-lg font-bold">
            {offer.title}
          </h3>
          <p className="text-muted">{storeName(offer.storeId)}</p>
        </div>
        {review ? (
          <DecisionBadge decision={review.decision} className="text-base" />
        ) : (
          <span className="text-muted">Checking…</span>
        )}
      </header>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">Price</dt>
        <dd>
          <Money
            value={offer.price}
            currency="EUR"
            source={offer.recordId}
            className="text-xl font-bold"
          />
        </dd>
        {offer.wasPrice !== undefined && (
          <>
            <dt className="text-muted">Store says it was</dt>
            <dd>
              <Money value={offer.wasPrice} currency="EUR" source={offer.recordId} />
            </dd>
          </>
        )}
        {offer.reductionStart && (
          <>
            <dt className="text-muted">Reduced since</dt>
            <dd>
              <SourceRef recordId={offer.recordId}>{offer.reductionStart}</SourceRef>
            </dd>
          </>
        )}
        {offer.stockLabel && (
          <>
            <dt className="text-muted">Stock label</dt>
            <dd>{offer.stockLabel}</dd>
          </>
        )}
      </dl>

      {review && (
        <section className="mt-3" aria-label={`Reviewer decision on ${offer.offerId}`}>
          <h4 className="font-semibold">Reviewer</h4>
          {review.disagreement && (
            <p className="mt-1 text-sm">
              The checkers disagreed:{' '}
              {review.disagreement.map((d) => `${d.checker} said ${d.decision}`).join(', ')}. The
              reviewer resolved it:
            </p>
          )}
          <ReasonList reasons={review.reasons} />
        </section>
      )}

      {(verdicts.length > 0 || groundingRejections.length > 0) && (
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-accent">
            Checker verdicts ({verdicts.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-3">
            {verdicts.map((verdict) => (
              <li key={verdict.checker}>
                <span className="font-mono font-semibold">{verdict.checker}</span>{' '}
                <DecisionBadge decision={verdict.decision} />
                <ReasonList reasons={verdict.reasons} />
              </li>
            ))}
            {groundingRejections.map((rejection) => (
              <li key={`${rejection.agent}:${rejection.at}`}>
                <GroundingNote rejection={rejection} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
