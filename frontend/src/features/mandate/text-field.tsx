import { useId, type ComponentPropsWithRef } from 'react';
import { cn } from '@lib/cn';

export type TextFieldProps = ComponentPropsWithRef<'input'> & { label: string; error?: string };

export function TextField({ label, error, className, ...input }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'rounded border border-line bg-surface px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent',
          error && 'border-reject',
          className,
        )}
        {...input}
      />
      {error && (
        <p id={errorId} className="text-sm text-reject">
          {error}
        </p>
      )}
    </div>
  );
}
