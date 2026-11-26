import { z } from 'zod';
import { RecordId } from '../records/record-id';
import { StoreIdSchema } from './store-id';

export const ReturnPolicy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refund'), days: z.int().positive() }),
  z.object({ kind: z.literal('all_sales_final') }),
  z.object({ kind: z.literal('none_stated') }),
]);
export type ReturnPolicy = z.infer<typeof ReturnPolicy>;

/** The signals merchant risk and the guard read about a store. */
export const StoreProfile = z.object({
  recordId: RecordId,
  storeId: StoreIdSchema,
  /** Fictional, e.g. "Pixel Harbour". */
  name: z.string().min(1),
  domainAgeDays: z.int().nonnegative(),
  returnPolicy: ReturnPolicy,
  /** The mandate's "trusted stores only" checks this flag. */
  trusted: z.boolean(),
});
export type StoreProfile = z.infer<typeof StoreProfile>;
