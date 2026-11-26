import { z } from 'zod';
import { GroundingRejected, ReviewDone, VerdictReady } from './check-events';
import {
  GuardDecided,
  PaymentFailed,
  PaymentRequested,
  PaymentSettled,
} from './payment-events';
import { OfferFound, ScoutFinished, ScoutStarted } from './scout-events';
import { SessionEnded, SessionStarted } from './session-events';

/** Every event Prickle publishes. The run log, SSE and the frontend all parse with this. */
export const PrickleEvent = z.discriminatedUnion('type', [
  SessionStarted,
  ScoutStarted,
  OfferFound,
  ScoutFinished,
  VerdictReady,
  GroundingRejected,
  ReviewDone,
  PaymentRequested,
  GuardDecided,
  PaymentSettled,
  PaymentFailed,
  SessionEnded,
]);
export type PrickleEvent = z.infer<typeof PrickleEvent>;
