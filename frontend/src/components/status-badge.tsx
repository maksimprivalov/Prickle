import { cn } from '@lib/cn';

export const Tone = {
  Pass: 'pass',
  Reject: 'reject',
  Unverified: 'unverified',
  Neutral: 'neutral',
} as const;
export type Tone = (typeof Tone)[keyof typeof Tone];

const style: Record<Tone, { icon: string; className: string }> = {
  pass: { icon: '✓', className: 'border-pass text-pass' },
  reject: { icon: '✕', className: 'border-reject text-reject' },
  unverified: { icon: '?', className: 'border-unverified text-unverified' },
  neutral: { icon: '•', className: 'border-line text-muted' },
};

export type StatusBadgeProps = { tone: Tone; label: string; className?: string };

/** Status as a word and an icon, never colour alone. */
export function StatusBadge({ tone, label, className }: StatusBadgeProps) {
  const { icon, className: toneClass } = style[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border-2 px-2 py-0.5 text-sm font-bold uppercase',
        toneClass,
        className,
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
