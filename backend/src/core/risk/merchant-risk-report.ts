import { z } from 'zod';
import { RecordId } from '../records/record-id';
import { ReasonCode } from '../verdicts/verdict';

/**
 * The merchant-risk agent's final answer. It names the records it gathered; the decision is
 * computed from those records in code (merchantRisk), and the agent's explanations are kept
 * only for the findings the code confirms.
 */
export const MerchantRiskReport = z.object({
  /** The checkout_total record for this offer. */
  checkout: RecordId,
  /** The store_profile record of the offer's store. */
  store: RecordId,
  /** Every offer record store_catalog returned for the store. May be empty. */
  storeOffers: z.array(RecordId),
  /** One plain explanation per risk the agent sees, keyed by reason code. */
  explanations: z.array(z.object({ code: z.enum(ReasonCode), text: z.string().min(1) })),
});
export type MerchantRiskReport = z.infer<typeof MerchantRiskReport>;
