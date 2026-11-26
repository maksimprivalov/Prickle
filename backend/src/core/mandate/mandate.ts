import { z } from 'zod';
import { Cents } from '../money/money';

/**
 * What the user allowed, exactly as they set it. The guard reads it from shared state; nothing
 * an agent produces may widen it. Its numbers cite MANDATE_RECORD_ID.
 */
export const Mandate = z.object({
  /** In the user's words, e.g. "55-inch TV". */
  description: z.string().min(1),
  /** Matches Offer.category, e.g. "tv". */
  category: z.string().min(1),
  /** When set, only offers with exactly this screen size match. */
  screenInches: z.int().positive().optional(),
  /** The most the user will pay in total, at checkout, fees included. */
  maxTotal: Cents.refine((value) => value > 0, 'must be more than zero'),
  /** Only a discount that passes the EU 30-day rule counts. */
  requireRealDiscount: z.boolean(),
  /** Only stores whose profile is marked trusted. */
  trustedStoresOnly: z.boolean(),
});
export type Mandate = z.infer<typeof Mandate>;
