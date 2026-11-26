export const EventName = {
  SessionStarted: 'session.started',
  ScoutStarted: 'scout.started',
  OfferFound: 'offer.found',
  ScoutFinished: 'scout.finished',
  VerdictReady: 'verdict.ready',
  GroundingRejected: 'grounding.rejected',
  ReviewDone: 'review.done',
  PaymentRequested: 'payment.requested',
  GuardDecided: 'guard.decided',
  PaymentSettled: 'payment.settled',
  PaymentFailed: 'payment.failed',
  SessionEnded: 'session.ended',
} as const;
export type EventName = (typeof EventName)[keyof typeof EventName];
