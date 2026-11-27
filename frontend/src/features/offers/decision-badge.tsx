import type { Decision } from '@prickle/backend/contracts';
import { StatusBadge, Tone } from '@components/status-badge';

const badge: Record<Decision, { tone: Tone; label: string }> = {
  pass: { tone: Tone.Pass, label: 'Passed' },
  reject: { tone: Tone.Reject, label: 'Rejected' },
  unverifiable: { tone: Tone.Unverified, label: 'Unverifiable' },
};

export type DecisionBadgeProps = { decision: Decision; className?: string };

export function DecisionBadge({ decision, className }: DecisionBadgeProps) {
  return <StatusBadge {...badge[decision]} className={className} />;
}
