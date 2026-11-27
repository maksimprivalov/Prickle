import { z } from 'zod';
import { Mandate } from '@prickle/backend/contracts';
import { eurosToCents } from '@lib/euros-to-cents';

// The form edits strings (euros as typed, an optional screen size); the output is the
// contract's Mandate, so the resolver hands the submit handler exactly what the server parses.

export const MandateForm = z
  .object({
    description: z.string().trim().min(1, 'Say what you want to buy, e.g. "55-inch TV".'),
    category: z.string().trim().min(1, 'Enter a category, e.g. "tv".'),
    screenInches: z
      .string()
      .trim()
      .regex(/^(\d{1,3})?$/, 'Enter whole inches, e.g. 55, or leave it empty.'),
    maxEuros: z.string().refine((value) => (eurosToCents(value) ?? 0) > 0, {
      message: 'Enter an amount in euros above zero, e.g. 600 or 599.99.',
    }),
    requireRealDiscount: z.boolean(),
    trustedStoresOnly: z.boolean(),
  })
  .transform(({ maxEuros, screenInches, ...rest }) => ({
    ...rest,
    maxTotal: eurosToCents(maxEuros),
    ...(screenInches === '' ? {} : { screenInches: Number.parseInt(screenInches, 10) }),
  }))
  .pipe(Mandate);

export type MandateFormValues = z.input<typeof MandateForm>;

/** The demo mandate from the idea doc. */
export const demoMandateValues: MandateFormValues = {
  description: '55-inch TV',
  category: 'tv',
  screenInches: '55',
  maxEuros: '600',
  requireRealDiscount: true,
  trustedStoresOnly: true,
};
