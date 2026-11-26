import { z } from 'zod';
import { Cents } from '../money/money';
import { RecordId } from '../records/record-id';

/** The price of one offer on one day. 60 daily rows per offer feed the EU 30-day rule. */
export const PriceHistoryRow = z.object({
  recordId: RecordId,
  offerId: z.string().min(1),
  date: z.iso.date(),
  price: Cents,
});
export type PriceHistoryRow = z.infer<typeof PriceHistoryRow>;
