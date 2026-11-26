import { z } from 'zod';
import { NOT_FINANCIAL_ADVICE } from '../disclaimer/disclaimer';
import { Mandate } from '../mandate/mandate';
import { Reason } from '../verdicts/verdict';
import { eventBase } from './event-base';
import { EventName } from './event-name';

/** The mandate as the user set it: the guard and the frontend read it from here. */
export const SessionStarted = z.object({
  ...eventBase,
  type: z.literal(EventName.SessionStarted),
  mandate: Mandate,
});
export type SessionStarted = z.infer<typeof SessionStarted>;

export const SessionOutcome = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('paid'), offerId: z.string().min(1) }),
  /** Nothing fit: the best option and every reason it falls outside the mandate. */
  z.object({
    kind: z.literal('no_fit'),
    bestOfferId: z.string().min(1).optional(),
    reasons: z.array(Reason),
  }),
  z.object({ kind: z.literal('failed'), detail: z.string().min(1) }),
]);
export type SessionOutcome = z.infer<typeof SessionOutcome>;

/** The last event. It cannot be built without the disclaimer. */
export const SessionEnded = z.object({
  ...eventBase,
  type: z.literal(EventName.SessionEnded),
  outcome: SessionOutcome,
  disclaimer: z.literal(NOT_FINANCIAL_ADVICE),
});
export type SessionEnded = z.infer<typeof SessionEnded>;
