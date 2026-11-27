import {
  EventName,
  type GroundingRejected,
  type GuardDecided,
  type Mandate,
  type Offer,
  type PaymentFailed,
  type PaymentRequested,
  type PaymentSettled,
  type PrickleEvent,
  type ReviewDone,
  type SessionEnded,
  type Verdict,
} from '@prickle/backend/contracts';

// The page is a pure function of the event list. This picks values out of events and keeps
// their record ids; it never computes money. The only arithmetic is milliseconds between event
// timestamps, for the timeline.

export type AgentLane = {
  agent: string;
  /** ms after the session's first event. */
  startMs: number;
  endMs: number;
  /** Still working: no finishing event yet. */
  running: boolean;
  /** A scout that finished with an error, in its own words. */
  failure?: string;
};

export type OfferView = {
  offer: Offer;
  verdicts: Verdict[];
  review?: ReviewDone;
  groundingRejections: GroundingRejected[];
  paymentRequest?: PaymentRequested;
  guard?: GuardDecided;
  payment?: PaymentSettled;
};

export type SessionView = {
  sessionId?: string;
  mandate?: Mandate;
  lanes: AgentLane[];
  /** Total ms from the first to the latest event: the timeline's axis. */
  spanMs: number;
  scoutsStarted: number;
  offers: OfferView[];
  /** In arrival order, including decisions on offers no scout reported. */
  guardDecisions: GuardDecided[];
  payments: PaymentSettled[];
  paymentFailures: PaymentFailed[];
  ended?: SessionEnded;
};

const LANE_ORDER = ['budget', 'deal-verifier', 'merchant-risk', 'reviewer', 'guard', 'pay'];
/** These emit events but are not agents working in parallel. */
const NOT_LANES = new Set(['app', 'eval']);

function laneRank(agent: string): number {
  if (agent.startsWith('scout-')) return 0;
  const index = LANE_ORDER.indexOf(agent);
  return index === -1 ? LANE_ORDER.length + 1 : index + 1;
}

export function reduceEvents(events: readonly PrickleEvent[]): SessionView {
  const view: SessionView = {
    lanes: [],
    spanMs: 0,
    scoutsStarted: 0,
    offers: [],
    guardDecisions: [],
    payments: [],
    paymentFailures: [],
  };
  const first = events[0];
  if (!first) return view;
  const t0 = Date.parse(first.at);
  const lanes = new Map<string, AgentLane>();
  const offers = new Map<string, OfferView>();
  const offerFor = (offerId: string) => offers.get(offerId);

  for (const event of events) {
    const ms = Date.parse(event.at) - t0;
    view.spanMs = Math.max(view.spanMs, ms);

    if (!NOT_LANES.has(event.agent)) {
      const lane = lanes.get(event.agent);
      const isScout = event.agent.startsWith('scout-');
      if (lane) {
        lane.endMs = Math.max(lane.endMs, ms);
      } else {
        lanes.set(event.agent, { agent: event.agent, startMs: ms, endMs: ms, running: isScout });
      }
    }

    switch (event.type) {
      case EventName.SessionStarted:
        view.sessionId = event.sessionId;
        view.mandate = event.mandate;
        break;
      case EventName.ScoutStarted:
        view.scoutsStarted += 1;
        break;
      case EventName.ScoutFinished: {
        const lane = lanes.get(event.agent);
        if (lane) {
          lane.running = false;
          if (!event.outcome.ok) lane.failure = event.outcome.detail;
        }
        break;
      }
      case EventName.OfferFound:
        if (!offers.has(event.offer.offerId)) {
          offers.set(event.offer.offerId, {
            offer: event.offer,
            verdicts: [],
            groundingRejections: [],
          });
        }
        break;
      case EventName.VerdictReady:
        offerFor(event.verdict.offerId)?.verdicts.push(event.verdict);
        break;
      case EventName.GroundingRejected:
        if (event.offerId) offerFor(event.offerId)?.groundingRejections.push(event);
        break;
      case EventName.ReviewDone: {
        const offer = offerFor(event.offerId);
        if (offer) offer.review = event;
        break;
      }
      case EventName.PaymentRequested: {
        const offer = offerFor(event.offerId);
        if (offer) offer.paymentRequest = event;
        break;
      }
      case EventName.GuardDecided: {
        view.guardDecisions.push(event);
        const offer = offerFor(event.offerId);
        if (offer) offer.guard = event;
        break;
      }
      case EventName.PaymentSettled: {
        view.payments.push(event);
        const offer = offerFor(event.offerId);
        if (offer) offer.payment = event;
        break;
      }
      case EventName.PaymentFailed:
        view.paymentFailures.push(event);
        break;
      case EventName.SessionEnded:
        view.ended = event;
        break;
    }
  }

  if (view.ended) for (const lane of lanes.values()) lane.running = false;
  view.lanes = [...lanes.values()].sort(
    (a, b) => laneRank(a.agent) - laneRank(b.agent) || a.agent.localeCompare(b.agent),
  );
  view.offers = [...offers.values()];
  return view;
}
