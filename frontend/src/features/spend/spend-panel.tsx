import { useEffect, useRef } from 'react';
import { MANDATE_RECORD_ID } from '@prickle/backend/contracts';
import { Money } from '@components/money';
import { ReasonList } from '@features/offers';
import type { SessionView } from '@features/session';
import { GuardDecision } from './guard-decision';
import { PaymentRow } from './payment-row';

export type SpendPanelProps = { view: SessionView };

export function SpendPanel({ view }: SpendPanelProps) {
  const { mandate, guardDecisions, payments, paymentFailures, ended } = view;
  const ref = useRef<HTMLDivElement>(null);
  const milestoneCount = guardDecisions.length + payments.length + (ended ? 1 : 0);

  // Move the decision into view as it lands, not only announce it.
  useEffect(() => {
    if (milestoneCount > 0) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [milestoneCount]);

  return (
    <div ref={ref} className="flex flex-col gap-4">
      {mandate && (
        <p className="text-lg">
          Mandate: at most{' '}
          <Money value={mandate.maxTotal} currency="EUR" source={MANDATE_RECORD_ID} /> at checkout,
          fees included.
        </p>
      )}

      {guardDecisions.length === 0 ? (
        <p className="text-muted">No payment has reached the guard yet.</p>
      ) : (
        <section aria-labelledby="guard-heading">
          <h3 id="guard-heading" className="text-lg font-bold">
            Mandate guard
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {guardDecisions.map((decided) => (
              <li key={`${decided.offerId}:${decided.at}`}>
                <GuardDecision decided={decided} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {payments.map((payment) => (
        <section key={payment.recordId} aria-label="Spend report">
          <PaymentRow payment={payment} />
        </section>
      ))}

      {paymentFailures.map((failure) => (
        <p
          key={`${failure.offerId}:${failure.at}`}
          role="alert"
          className="font-semibold text-reject"
        >
          Payment for {failure.offerId} failed ({failure.wallet} wallet): {failure.detail}
        </p>
      ))}

      {ended?.outcome.kind === 'no_fit' && (
        <section aria-labelledby="no-fit-heading">
          <h3 id="no-fit-heading" className="text-lg font-bold">
            Nothing fits your mandate. Nothing was paid.
          </h3>
          {ended.outcome.bestOfferId && (
            <p>
              Best option: <span className="font-mono">{ended.outcome.bestOfferId}</span>. Why it
              does not fit:
            </p>
          )}
          <ReasonList reasons={ended.outcome.reasons} />
        </section>
      )}
      {ended?.outcome.kind === 'failed' && (
        <p role="alert" className="font-semibold text-reject">
          The session failed: {ended.outcome.detail}
        </p>
      )}
    </div>
  );
}
