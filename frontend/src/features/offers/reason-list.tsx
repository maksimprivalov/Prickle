import type { Reason } from '@prickle/backend/contracts';
import { SourceRef } from '@components/source-ref';

export type ReasonListProps = { reasons: Reason[] };

/** Each reason in the agent's words, with every record it cites. */
export function ReasonList({ reasons }: ReasonListProps) {
  return (
    <ul className="mt-1 flex flex-col gap-2">
      {reasons.map((reason) => (
        <li key={`${reason.code}:${reason.text}`}>
          <span className="font-mono text-xs text-muted">{reason.code}</span> {reason.text}
          <span className="mt-1 flex flex-wrap gap-1">
            {reason.sources.map((source) => (
              <SourceRef key={source} recordId={source} />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
