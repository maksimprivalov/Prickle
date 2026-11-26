import { z } from 'zod';
import { RecordId } from '../records/record-id';

/**
 * A scout's final answer. It names offers by record id only: the offer itself (price, "was"
 * price, stock label) is taken from the record the store tool returned, never from the model,
 * so a scout cannot change a number on its way to the checkers.
 */
export const ScoutReport = z.object({
  /** Record ids of the offers that are the product the shopper asked for. May be empty. */
  matches: z.array(RecordId),
  /** One or two plain sentences: what was searched and what matched or nearly matched. */
  note: z.string().min(1),
});
export type ScoutReport = z.infer<typeof ScoutReport>;
