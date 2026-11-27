import type { GuardDecided } from '@prickle/backend/contracts';
import { Money } from '@components/money';
import { SourceRef } from '@components/source-ref';
import { StatusBadge, Tone } from '@components/status-badge';

export type GuardDecisionProps = { decided: GuardDecided };

/** The guard's decision exactly as received: a deny lists every reason and the values compared. */
export function GuardDecision({ decided }: GuardDecisionProps) {
  const { decision, offerId } = decided;
  return (
    <div className="rounded-lg border-2 border-line p-3">
      <p className="flex flex-wrap items-center gap-2 text-lg">
        <StatusBadge
          tone={decision.allow ? Tone.Pass : Tone.Reject}
          label={decision.allow ? 'Allowed' : 'Denied'}
          className="text-lg"
        />
        <span>
          Payment for <span className="font-mono">{offerId}</span>
        </span>
      </p>
      {!decision.allow && (
        <ul className="mt-2 flex flex-col gap-2">
          {decision.reasons.map((reason) => (
            <li key={reason.code}>
              <span className="font-mono text-xs text-muted">{reason.code}</span> {reason.message}
              {reason.compared.length > 0 && (
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
                  {reason.compared.map((c) => (
                    <div key={c.label} className="contents">
                      <dt className="text-muted">{c.label}</dt>
                      <dd>
                        <Money value={c.value.amount} currency="EUR" source={c.value.recordId} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <span className="mt-1 flex flex-wrap gap-1">
                {[...new Set(reason.sources)].map((source) => (
                  <SourceRef key={source} recordId={source} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
