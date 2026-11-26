import { describe, expect, it } from 'vitest';
import { NOT_FINANCIAL_ADVICE } from '../disclaimer/disclaimer';
import { EventName } from './event-name';
import { PrickleEvent } from './prickle-event';

const base = (agent: string, second: number) => ({
  sessionId: 'session-1',
  at: `2026-11-27T10:00:${String(second).padStart(2, '0')}.000Z`,
  agent,
});

const mandate = {
  description: '55-inch TV',
  category: 'tv',
  screenInches: 55,
  maxTotal: 60000,
  requireRealDiscount: true,
  trustedStoresOnly: true,
};

const storeBOffer = {
  recordId: 'b-tv55-of-1',
  offerId: 'b-tv55',
  storeId: 'b',
  title: 'Northwind 55" 4K TV',
  category: 'tv',
  screenInches: 55,
  price: 58500,
  wasPrice: 69900,
  reductionStart: '2026-11-20',
};

// The demo story from the idea doc: Store B passes, Store D's €599 becomes €648 at checkout.
const demoRun = [
  { ...base('app', 0), type: EventName.SessionStarted, mandate },
  { ...base('scout-b', 1), type: EventName.ScoutStarted, storeId: 'b' },
  { ...base('scout-b', 2), type: EventName.OfferFound, offer: storeBOffer },
  { ...base('scout-b', 3), type: EventName.ScoutFinished, storeId: 'b', outcome: { ok: true } },
  {
    ...base('scout-e', 3),
    type: EventName.ScoutFinished,
    storeId: 'e',
    outcome: { ok: false, detail: 'store E timed out' },
  },
  {
    ...base('deal-verifier', 4),
    type: EventName.VerdictReady,
    verdict: {
      offerId: 'b-tv55',
      checker: 'deal-verifier',
      decision: 'pass',
      reasons: [
        {
          code: 'real_discount',
          text: 'Was 699.00 for the 30 days before the reduction.',
          sources: ['b-tv55-ph-1001', 'b-tv55-ph-1030'],
        },
      ],
    },
  },
  {
    ...base('merchant-risk', 5),
    type: EventName.GroundingRejected,
    offerId: 'b-tv55',
    unsourcedNumbers: ['649.00'],
  },
  {
    ...base('reviewer', 6),
    type: EventName.ReviewDone,
    offerId: 'b-tv55',
    decision: 'pass',
    reasons: [
      { code: 'store_looks_sound', text: '30-day refund policy.', sources: ['b-profile-1'] },
    ],
    disagreement: [
      { checker: 'deal-verifier', decision: 'pass' },
      { checker: 'merchant-risk', decision: 'unverifiable' },
    ],
  },
  {
    ...base('budget', 7),
    type: EventName.PaymentRequested,
    offerId: 'b-tv55',
    storeId: 'b',
    total: { amount: 58500, recordId: 'b-tv55-co-1' },
  },
  { ...base('guard', 8), type: EventName.GuardDecided, offerId: 'b-tv55', decision: { allow: true } },
  {
    ...base('guard', 8),
    type: EventName.GuardDecided,
    offerId: 'd-tv55',
    decision: {
      allow: false,
      reasons: [
        {
          code: 'over_mandate',
          message: 'Checkout total is above the mandate.',
          compared: [
            { label: 'checkout total', value: { amount: 64800, recordId: 'd-tv55-co-7' } },
            { label: 'mandate max', value: { amount: 60000, recordId: 'mandate' } },
          ],
          sources: ['d-tv55-co-7', 'mandate'],
        },
      ],
    },
  },
  {
    ...base('payments', 9),
    type: EventName.PaymentSettled,
    recordId: 'payment-1',
    offerId: 'b-tv55',
    storeId: 'b',
    amount: 585_000_000,
    spent: 585_000_000,
    cap: 600_000_000,
    wallet: 'mock',
    signature: 'mock-0001',
  },
  {
    ...base('app', 10),
    type: EventName.SessionEnded,
    outcome: { kind: 'paid', offerId: 'b-tv55' },
    disclaimer: NOT_FINANCIAL_ADVICE,
  },
];

describe('PrickleEvent', () => {
  it('parses every event of the demo run', () => {
    for (const event of demoRun) {
      expect(PrickleEvent.safeParse(event).success, event.type).toBe(true);
    }
  });

  it('covers every event name with a schema', () => {
    const covered = new Set(PrickleEvent.options.map((option) => option.shape.type.value));
    expect([...covered].sort()).toEqual(Object.values(EventName).sort());
  });

  it('rejects an unknown event type', () => {
    expect(PrickleEvent.safeParse({ ...base('app', 0), type: 'offer.lost' }).success).toBe(false);
  });

  it('rejects an event without a session, time or emitting agent', () => {
    for (const field of ['sessionId', 'at', 'agent']) {
      const event: Record<string, unknown> = { ...demoRun[1] };
      delete event[field];
      expect(PrickleEvent.safeParse(event).success, field).toBe(false);
    }
  });

  it('rejects a price in euros as a float instead of integer cents', () => {
    const event = {
      ...base('scout-b', 2),
      type: EventName.OfferFound,
      offer: { ...storeBOffer, price: 585.0 + 0.5 },
    };
    expect(PrickleEvent.safeParse(event).success).toBe(false);
  });

  it('rejects a verdict reason that cites no record', () => {
    const event = {
      ...base('deal-verifier', 4),
      type: EventName.VerdictReady,
      verdict: {
        offerId: 'b-tv55',
        checker: 'deal-verifier',
        decision: 'pass',
        reasons: [{ code: 'real_discount', text: 'Looks like a real deal.', sources: [] }],
      },
    };
    expect(PrickleEvent.safeParse(event).success).toBe(false);
  });

  it('rejects a guard deny that gives no reason', () => {
    const event = {
      ...base('guard', 8),
      type: EventName.GuardDecided,
      offerId: 'd-tv55',
      decision: { allow: false, reasons: [] },
    };
    expect(PrickleEvent.safeParse(event).success).toBe(false);
  });

  it('rejects a session end without the not-financial-advice line', () => {
    const event = {
      ...base('app', 10),
      type: EventName.SessionEnded,
      outcome: { kind: 'paid', offerId: 'b-tv55' },
      disclaimer: 'Great deal!',
    };
    expect(PrickleEvent.safeParse(event).success).toBe(false);
  });

  it('rejects a mandate with a zero budget', () => {
    const event = {
      ...base('app', 0),
      type: EventName.SessionStarted,
      mandate: { ...mandate, maxTotal: 0 },
    };
    expect(PrickleEvent.safeParse(event).success).toBe(false);
  });

  it('rejects a record id that is not lowercase-and-hyphens', () => {
    const event = {
      ...base('scout-b', 2),
      type: EventName.OfferFound,
      offer: { ...storeBOffer, recordId: 'B TV55 offer' },
    };
    expect(PrickleEvent.safeParse(event).success).toBe(false);
  });
});
