import { z } from 'zod';
import { Checker, Decision, Reason, Verdict } from '../verdicts/verdict';
import { eventBase } from './event-base';
import { EventName } from './event-name';

/** A checker's verdict on one offer, after it passed the grounding check. */
export const VerdictReady = z.object({
  ...eventBase,
  type: z.literal(EventName.VerdictReady),
  verdict: Verdict,
});
export type VerdictReady = z.infer<typeof VerdictReady>;

/** An agent output dropped before the reviewer saw it: numbers no tool returned this run. */
export const GroundingRejected = z.object({
  ...eventBase,
  type: z.literal(EventName.GroundingRejected),
  offerId: z.string().min(1).optional(),
  /** The numbers as the agent wrote them, e.g. ["649.00"]. */
  unsourcedNumbers: z.array(z.string().min(1)).min(1),
});
export type GroundingRejected = z.infer<typeof GroundingRejected>;

/**
 * The reviewer's final word on an offer. When the checkers disagree, `disagreement` names who
 * said what and the reasons explain how it was resolved (fix 4).
 */
export const ReviewDone = z.object({
  ...eventBase,
  type: z.literal(EventName.ReviewDone),
  offerId: z.string().min(1),
  decision: z.enum(Decision),
  reasons: z.array(Reason).min(1),
  disagreement: z
    .array(z.object({ checker: z.enum(Checker), decision: z.enum(Decision) }))
    .min(2)
    .optional(),
});
export type ReviewDone = z.infer<typeof ReviewDone>;
