// The frontend contract (`@prickle/backend/contracts`): every event, the mandate, and the
// record, verdict and money shapes they carry. Owner: Tara (see ../../../../work-split.md).
// Inside src/core/, use relative imports only: the frontend imports these files without our
// path aliases. A change here changes the run log format and the frontend: say so in the PR.

export { GroundingRejected, ReviewDone, VerdictReady } from './check-events';
export { EventName } from './event-name';
export {
  GuardDecided,
  GuardDecision,
  GuardReason,
  GuardReasonCode,
  PaymentFailed,
  PaymentRequested,
  PaymentSettled,
  WalletKind,
} from './payment-events';
export { PrickleEvent } from './prickle-event';
export { OfferFound, ScoutFinished, ScoutStarted } from './scout-events';
export { SessionEnded, SessionOutcome, SessionStarted } from './session-events';

export { NOT_FINANCIAL_ADVICE } from '../disclaimer/disclaimer';
export { Mandate } from '../mandate';
export { Cents, UsdcUnits } from '../money';
export {
  CheckoutBreakdown,
  CheckoutLine,
  CheckoutLineKind,
  Offer,
  PriceHistoryRow,
  ReturnPolicy,
  StoreId,
  StoreIdSchema,
  StoreProfile,
} from '../offers';
export { MANDATE_RECORD_ID, RecordId, SourcedCents, SourcedUsdc } from '../records';
export { Checker, Decision, Reason, ReasonCode, Verdict } from '../verdicts';
