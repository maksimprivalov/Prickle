import type { ReactNode } from 'react';

export type SourceRefProps = {
  recordId: string;
  /** What the record is, for the accessible description: "price history". */
  label?: string;
  children?: ReactNode;
};

/**
 * A value with the record it came from: the record id shows on hover and keyboard focus, and
 * screen readers hear it as the description.
 */
export function SourceRef({ recordId, label = 'record', children }: SourceRefProps) {
  const description = `Source: ${label} ${recordId}`;
  return (
    <span className="group relative inline-flex items-baseline gap-1">
      {children}
      <span
        tabIndex={0}
        role="note"
        aria-label={description}
        title={description}
        className="cursor-help rounded border border-line px-1 font-mono text-xs text-muted focus-visible:outline-2 focus-visible:outline-accent"
      >
        {recordId}
      </span>
    </span>
  );
}
