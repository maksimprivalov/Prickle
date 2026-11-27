import { z } from 'zod';

/** The budget agent's final answer: which offer it paid, if any, and why in plain words. */
export const BudgetAnswer = z.object({
  /** The offer pay() settled, or null when no candidate could be paid. */
  paidOfferId: z.string().min(1).nullable(),
  /** One or two plain sentences, no numbers: the spend report carries the numbers. */
  note: z.string().min(1),
});
export type BudgetAnswer = z.infer<typeof BudgetAnswer>;
