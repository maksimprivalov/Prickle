import type { GroundingRejected } from '@prickle/backend/contracts';

export type GroundingNoteProps = { rejection: GroundingRejected };

/** An agent answer dropped by the grounding check (fix 1), shown so nothing is silently lost. */
export function GroundingNote({ rejection }: GroundingNoteProps) {
  return (
    <p className="text-sm">
      <span className="font-mono font-semibold">{rejection.agent}</span>: an answer was dropped
      because it quoted numbers no tool returned ({rejection.unsourcedNumbers.join(', ')}).
    </p>
  );
}
