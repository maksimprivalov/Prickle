import { describe, expect, it } from 'vitest';
import evalRun from '@test/fixtures/eval-scripted-run.jsonl?raw';
import sampleRun from '@test/fixtures/sample-run.jsonl?raw';
import { replay, runLogMessages } from '@test/run-log';
import { milestones } from './milestones';
import { reduceEvents } from './reduce-events';

describe('reduceEvents on the recorded demo run', () => {
  const view = reduceEvents(replay(runLogMessages(sampleRun)).events);

  it('keeps the mandate as the user set it', () => {
    expect(view.mandate).toMatchObject({ maxTotal: 60000, screenInches: 55 });
  });

  it('has one lane per agent, the five scouts first, all finished', () => {
    expect(view.lanes.map((l) => l.agent)).toEqual([
      'scout-a',
      'scout-b',
      'scout-c',
      'scout-d',
      'scout-e',
      'deal-verifier',
      'merchant-risk',
      'reviewer',
      'guard',
      'pay',
    ]);
    expect(view.lanes.every((l) => !l.running)).toBe(true);
    expect(view.scoutsStarted).toBe(5);
  });

  it('shows the scouts overlapping in time: the concurrency proof', () => {
    const scouts = view.lanes.filter((l) => l.agent.startsWith('scout-'));
    const lastStart = Math.max(...scouts.map((l) => l.startMs));
    const firstEnd = Math.min(...scouts.map((l) => l.endMs));
    expect(lastStart).toBeLessThan(firstEnd);
  });

  it('collects each offer with its verdicts and the reviewer decision', () => {
    const byId = new Map(view.offers.map((o) => [o.offer.offerId, o]));
    expect(byId.get('b-tv55')?.review?.decision).toBe('pass');
    expect(byId.get('c-tv55')?.review?.reasons[0]?.code).toBe('fake_discount');
    expect(byId.get('d-tv55')?.review?.reasons[0]?.code).toBe('hidden_fee');
    expect(byId.get('b-tv55')?.offer).toMatchObject({ price: 58500, recordId: 'b-tv55-of-1' });
    for (const offer of view.offers) expect(offer.verdicts).toHaveLength(2);
  });

  it('records the guard allowing Store B and the payment as the event carried it', () => {
    expect(view.guardDecisions).toEqual([
      expect.objectContaining({ offerId: 'b-tv55', decision: { allow: true } }),
    ]);
    expect(view.payments).toEqual([
      expect.objectContaining({
        recordId: 'b-tv55-pay-1',
        amount: 585_000_000,
        spent: 585_000_000,
        cap: 600_000_000,
        wallet: 'mock',
      }),
    ]);
    expect(view.ended?.outcome).toEqual({ kind: 'paid', offerId: 'b-tv55' });
  });

  it('announces the milestones only', () => {
    expect(milestones(view)).toEqual(
      expect.arrayContaining([
        '5 scouts started',
        'Offer from Store B passed',
        'Offer from Store D was rejected',
        'Guard allowed payment for b-tv55',
        'Payment settled: 585 test USDC',
      ]),
    );
  });
});

describe('reduceEvents on the recorded eval run', () => {
  const view = reduceEvents(replay(runLogMessages(evalRun)).events);

  it('keeps every guard deny with the values it compared and their sources', () => {
    const denies = view.guardDecisions.filter((d) => !d.decision.allow);
    expect(denies.length).toBeGreaterThan(0);
    const decision = denies.find((d) => d.offerId === 'a-tv55')?.decision;
    if (decision?.allow !== false) throw new Error('expected a deny for a-tv55');
    const overMandate = decision.reasons.find((r) => r.code === 'over_mandate');
    expect(overMandate?.compared).toEqual(
      expect.arrayContaining([
        { label: 'Checkout total', value: { amount: 74900, recordId: 'a-tv55-co-1' } },
        { label: 'Mandate maximum', value: { amount: 60000, recordId: 'mandate' } },
      ]),
    );
  });

  it('draws no lane for the eval driver itself', () => {
    expect(view.lanes.map((l) => l.agent)).not.toContain('eval');
  });
});

it('reduces an empty stream to an empty view', () => {
  expect(reduceEvents([])).toMatchObject({ lanes: [], offers: [], guardDecisions: [] });
});
