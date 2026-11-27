import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Mandate } from '@prickle/backend/contracts';
import { ApiError } from '@lib/api';
import { TextField } from './text-field';
import { demoMandateValues, MandateForm, type MandateFormValues } from './mandate-form-schema';

export type MandateFormProps = {
  onStart: (mandate: Mandate) => Promise<void>;
  /** A session is running: one at a time. */
  busy: boolean;
};

export function MandateFormPanel({ onStart, busy }: MandateFormProps) {
  const [submitError, setSubmitError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MandateFormValues, unknown, Mandate>({
    resolver: zodResolver(MandateForm),
    defaultValues: demoMandateValues,
  });

  async function handleValid(mandate: Mandate) {
    setSubmitError(undefined);
    try {
      await onStart(mandate);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not start the session.');
    }
  }

  const disabled = isSubmitting || busy;
  const why = isSubmitting ? 'Starting…' : busy ? 'Prickle is shopping…' : undefined;

  return (
    <section aria-labelledby="mandate-heading" className="rounded-lg border border-line p-4">
      <h2 id="mandate-heading" className="text-xl font-bold">
        Your mandate
      </h2>
      <form
        noValidate
        onSubmit={(e) => void handleSubmit(handleValid)(e)}
        className="mt-3 grid gap-3 sm:grid-cols-2"
      >
        <TextField
          label="What to buy"
          error={errors.description?.message}
          {...register('description')}
        />
        <TextField label="Category" error={errors.category?.message} {...register('category')} />
        <TextField
          label="Screen size (inches, optional)"
          inputMode="numeric"
          error={errors.screenInches?.message}
          {...register('screenInches')}
        />
        <TextField
          label="Maximum total at checkout (EUR)"
          inputMode="decimal"
          error={errors.maxEuros?.message}
          {...register('maxEuros')}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-accent"
            {...register('requireRealDiscount')}
          />
          Only a real discount (EU 30-day rule)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-accent"
            {...register('trustedStoresOnly')}
          />
          Only trusted stores
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={disabled}
            aria-describedby={why ? 'submit-why' : undefined}
            className="rounded bg-accent px-5 py-2 text-lg font-bold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            Shop for me
          </button>
          {why && (
            <span id="submit-why" className="text-muted">
              {why}
            </span>
          )}
          {submitError && (
            <p role="alert" className="font-semibold text-reject">
              {submitError}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
