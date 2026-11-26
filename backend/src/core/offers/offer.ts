import { z } from 'zod';
import { Cents } from '../money/money';
import { RecordId } from '../records/record-id';
import { StoreIdSchema } from './store-id';

/** One listing as a store shows it, before checkout. Prices are list prices, not totals. */
export const Offer = z.object({
  recordId: RecordId,
  /** Unique across stores, e.g. "c-tv55". */
  offerId: z.string().min(1),
  storeId: StoreIdSchema,
  title: z.string().min(1),
  category: z.string().min(1),
  screenInches: z.int().positive().optional(),
  price: Cents,
  /** The "was" price the store advertises; absent when no discount is claimed. */
  wasPrice: Cents.optional(),
  /** First day of the advertised reduction (YYYY-MM-DD); the 30-day rule looks before it. */
  reductionStart: z.iso.date().optional(),
  /** Stock text as shown, e.g. "Only 2 left!". Fake scarcity is judged from it. */
  stockLabel: z.string().optional(),
});
export type Offer = z.infer<typeof Offer>;
