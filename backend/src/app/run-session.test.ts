import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fixtures } from '@test/fixtures';
import { PrickleEvent } from '@core/events';
import { Mandate } from '@core/mandate';
import { cents, formatEur, usdcUnits } from '@core/money';
import { createMockWallet } from '@payments/mock-wallet';
import type { ModelDriver } from '@runtime/plain/plain-runtime';
import { createPlainRuntime } from '@runtime/plain/plain-runtime';
import { RunLogLine, createMemoryRunLog } from '@runtime/run-log';
import { createMockStoresApp } from '../mock-stores/app';
import { loadFixtures } from '../mock-stores/fixtures';
import { createGroundingCheck } from './grounding-check';
import { runSession, type SessionState } from './run-session';

// The whole demo session on the plain runtime: Tara's real mock stores in-process, a scripted
// model in place of the LLM. Checks the 20:00 milestone: five scouts → checkers → guard → pay.

const ScoutHit = z.object({
  ok: z.literal(true),
  offers: z.array(z.object({ recordId: z.string() })),
});
const OfferMessage = z.object({ recordId: z.string(), storeId: z.string(), offerId: z.string() });
const History = z.object({
  ok: z.literal(true),
  rows: z.array(z.object({ recordId: z.string(), date: z.string(), price: z.number() })),
});
type DealScript = (
  offer: z.infer<typeof OfferMessage>,
  rows: z.infer<typeof History>['rows'],
) => { conclusion: string; text: string; sources: string[] };
const BudgetMessage = z.object({
  candidates: z.array(
    z.object({
      offerId: z.string(),
      checkoutTotal: z.object({ amount: z.number() }).nullable(),
      verdicts: z.array(z.object({ decision: z.string() })),
      review: z.object({ decision: z.string() }).nullable(),
    }),
  ),
});
const ReviewMessage = z.object({
  offerId: z.string(),
  verdicts: z.array(z.object({ reasons: z.array(z.object({ sources: z.array(z.string()) })) })),
  finalDecision: z.string(),
});
// A call the guard blocked before pay() ran comes back as { blocked, reason }, without a status.
const PayResult = z.object({ status: z.string().optional() }).loose();

/** What a sensible model would do, per agent. The budget step tries the cheapest first. */
const scriptedModel =
  (
    options: { budgetIgnoresVerdicts?: boolean; deal?: DealScript; reviewText?: string } = {},
  ): ModelDriver =>
  async ({ agent, message, callTool }) => {
    if (agent.name.startsWith('scout-')) {
      const hit = ScoutHit.safeParse(
        await callTool('search_catalog', { category: 'tv', screenInches: 55 }),
      );
      return {
        matches: hit.success ? hit.data.offers.map((o) => o.recordId) : [],
        note: 'Searched TVs.',
      };
    }
    if (agent.name === 'deal-verifier') {
      const offer = OfferMessage.parse(JSON.parse(message));
      const history = History.safeParse(
        await callTool('price_history', { storeId: offer.storeId, offerId: offer.offerId }),
      );
      const rows = history.success ? history.data.rows : [];
      return (
        options.deal?.(offer, rows) ?? {
          conclusion: 'real',
          text: 'Looks like a real discount.',
          sources: [offer.recordId],
        }
      );
    }
    if (agent.name === 'reviewer') {
      const review = ReviewMessage.parse(JSON.parse(message));
      const source = review.verdicts[0]?.reasons[0]?.sources[0] ?? `${review.offerId}-of-1`;
      return {
        text: options.reviewText ?? `Reviewed: the offer is ${review.finalDecision}.`,
        sources: [source],
      };
    }
    if (agent.name === 'budget') {
      const { candidates } = BudgetMessage.parse(JSON.parse(message));
      const ranked = candidates
        .filter((c) => c.checkoutTotal !== null)
        .filter((c) => options.budgetIgnoresVerdicts || c.review?.decision === 'pass')
        .sort((a, b) => (a.checkoutTotal?.amount ?? 0) - (b.checkoutTotal?.amount ?? 0));
      for (const candidate of ranked) {
        const result = PayResult.parse(await callTool('pay', { offerId: candidate.offerId }));
        if (result.status === 'paid') return { paidOfferId: candidate.offerId, note: 'Paid.' };
      }
      return { paidOfferId: null, note: 'Nothing could be paid.' };
    }
    throw new Error(`no script for ${agent.name}`);
  };

async function demo(driver: ModelDriver, mandate: unknown = fixtures.mandate) {
  const app = createMockStoresApp({ fixtures: await loadFixtures() });
  const log = createMemoryRunLog();
  const wallet = createMockWallet(usdcUnits(600_000_000));
  const transfer = vi.spyOn(wallet, 'transfer');
  const runtime = createPlainRuntime<PrickleEvent, SessionState>({
    sessionId: 'demo-test',
    state: { mandate: Mandate.parse(mandate), verdicts: [] },
    driver,
    log,
    clock: () => new Date('2026-11-27T20:00:00.000Z'),
    // As in pnpm demo: fix 1 runs on every checker's answer.
    checkOutput: createGroundingCheck({
      sessionId: 'demo-test',
      mandate: Mandate.parse(mandate),
      clock: () => new Date('2026-11-27T20:00:00.000Z'),
      publish: (event) => runtime.publish(event),
    }),
  });
  const events: PrickleEvent[] = [];
  runtime.observe('*', (e) => events.push(PrickleEvent.parse(e)));
  const result = await runSession({
    runtime,
    client: { baseUrl: 'http://stores.test', fetch: async (url, init) => app.request(url, init) },
    wallet,
    clock: () => new Date('2026-11-27T20:00:00.000Z'),
  });
  return { result, events, log, transfer, wallet };
}

describe('runSession(): the demo mandate', () => {
  it('pays only Store B, 585 test USDC, and ends with the disclaimer', async () => {
    const { result, events, transfer } = await demo(scriptedModel());

    expect(result.outcome).toEqual({ kind: 'paid', offerId: 'b-tv55' });
    expect(transfer).toHaveBeenCalledOnce();
    expect(transfer).toHaveBeenCalledWith({
      storeId: 'b',
      amount: 585_000_000,
      reference: 'demo-test:b-tv55',
    });
    expect(events.find((e) => e.type === 'payment.settled')).toMatchObject({
      amount: 585_000_000,
      spent: 585_000_000,
      cap: 600_000_000,
      signature: 'mock-1',
    });
    const last = events.at(-1);
    expect(last?.type).toBe('session.ended');
    expect(last?.type === 'session.ended' && last.disclaimer).toContain('Not financial advice');
  });

  it('finds one 55-inch TV per store and checks each with both checkers', async () => {
    const { result } = await demo(scriptedModel());
    expect(result.scouts.flatMap((s) => s.offers.map((o) => o.offerId)).sort()).toEqual([
      'a-tv55',
      'b-tv55',
      'c-tv55',
      'd-tv55',
      'e-tv55',
    ]);
    const byOffer = (offerId: string) =>
      Object.fromEntries(
        result.verdicts.filter((v) => v.offerId === offerId).map((v) => [v.checker, v.decision]),
      );
    expect(byOffer('b-tv55')).toEqual({ 'deal-verifier': 'pass', 'merchant-risk': 'pass' });
    expect(byOffer('c-tv55')).toEqual({ 'deal-verifier': 'reject', 'merchant-risk': 'pass' });
    expect(byOffer('d-tv55')).toEqual({ 'deal-verifier': 'pass', 'merchant-risk': 'reject' });
    expect(byOffer('e-tv55')).toEqual({ 'deal-verifier': 'pass', 'merchant-risk': 'reject' });
  });

  it('decides Store C in code even when the agent calls the discount real', async () => {
    const { result } = await demo(scriptedModel());
    const c = result.verdicts.find((v) => v.offerId === 'c-tv55' && v.checker === 'deal-verifier');
    expect(c?.reasons[0]?.code).toBe('fake_discount');
    expect(c?.reasons[0]?.text).toContain('the 30-day rule in code decides');
  });

  it('starts all five scouts before any finishes, and the checkers before the scouts end', async () => {
    const { log } = await demo(scriptedModel());
    const lines = log.lines();
    for (const line of lines) expect(RunLogLine.safeParse(line).success).toBe(true);
    const index = (test: (l: (typeof lines)[number]) => boolean) => lines.findIndex(test);
    const lastScoutStart = lines.reduce(
      (at, l, i) => (l.kind === 'loop.started' && l.agent.startsWith('scout-') ? i : at),
      -1,
    );
    const firstScoutEnd = index((l) => l.kind === 'loop.finished' && l.agent.startsWith('scout-'));
    expect(lastScoutStart).toBeLessThan(firstScoutEnd);
  });

  it('still pays only B when the budget agent tries every offer, cheapest first', async () => {
    // A careless budget agent: E (€559) and D are tried before B. The guard refuses them.
    const { result, transfer, events } = await demo(scriptedModel({ budgetIgnoresVerdicts: true }));
    expect(result.outcome).toEqual({ kind: 'paid', offerId: 'b-tv55' });
    expect(transfer).toHaveBeenCalledOnce();
    const denied = events.flatMap((e) =>
      e.type === 'guard.decided' && !e.decision.allow ? [e.offerId] : [],
    );
    expect(denied).toContain('e-tv55');
  });

  it('pays nothing and names the best option when nothing fits', async () => {
    const mandate = { ...fixtures.mandate, maxTotal: 50000 };
    const { result, transfer } = await demo(scriptedModel(), mandate);
    expect(transfer).not.toHaveBeenCalled();
    expect(result.outcome).toMatchObject({ kind: 'no_fit', bestOfferId: 'b-tv55' });
  });

  it('reports a failed session when every scout fails', async () => {
    const { result, transfer } = await demo(() => Promise.reject(new Error('model down')));
    expect(result.outcome).toMatchObject({ kind: 'failed' });
    expect(transfer).not.toHaveBeenCalled();
  });

  it('drops a checker answer with an invented number, and the code verdict stands', async () => {
    // The deal verifier claims B "was €749.00": no record says so (B was €699.00).
    const { result, events } = await demo(
      scriptedModel({
        deal: (offer) => ({
          conclusion: 'real',
          text: 'It was €749.00 before the cut.',
          sources: [offer.recordId],
        }),
      }),
    );
    const rejected = events.filter((e) => e.type === 'grounding.rejected');
    expect(rejected).toContainEqual(
      expect.objectContaining({
        agent: 'deal-verifier',
        offerId: 'b-tv55',
        unsourcedNumbers: ['749.00'],
      }),
    );
    // The answer is gone; the verdict carries the code's own wording, and B is still paid.
    const b = result.verdicts.find((v) => v.offerId === 'b-tv55' && v.checker === 'deal-verifier');
    expect(b?.decision).toBe('pass');
    expect(b?.reasons[0]?.text).not.toContain('749');
    expect(result.outcome).toEqual({ kind: 'paid', offerId: 'b-tv55' });
  });

  it('keeps a checker answer whose numbers all come from cited records', async () => {
    const { events, result } = await demo(
      scriptedModel({
        deal: (offer, rows) => {
          const row = rows.find((r) => r.date === '2026-11-01');
          if (!row) throw new Error('row missing');
          const euros = formatEur(cents(row.price));
          return {
            conclusion: offer.offerId === 'c-tv55' ? 'fake' : 'real',
            text: `On 2026-11-01 it cost ${euros}, within the 30 days before the reduction.`,
            sources: [offer.recordId, row.recordId],
          };
        },
      }),
    );
    expect(events.filter((e) => e.type === 'grounding.rejected')).toEqual([]);
    const c = result.verdicts.find((v) => v.offerId === 'c-tv55' && v.checker === 'deal-verifier');
    expect(c?.reasons[0]?.text).toBe(
      'On 2026-11-01 it cost €649.00, within the 30 days before the reduction.',
    );
  });

  it('reviews every offer once both checkers have judged it, and logs each disagreement', async () => {
    const { result, events } = await demo(scriptedModel());
    const byOffer = Object.fromEntries(result.reviews.map((r) => [r.offerId, r]));
    expect(Object.keys(byOffer).sort()).toEqual(['a-tv55', 'b-tv55', 'c-tv55', 'd-tv55', 'e-tv55']);
    expect(byOffer['b-tv55']).toMatchObject({ decision: 'pass' });
    expect(byOffer['b-tv55']?.disagreement).toBeUndefined();
    // A passes both checks; the guard is what turns it down (€749 > €600).
    expect(byOffer['a-tv55']).toMatchObject({ decision: 'pass' });
    expect(byOffer['c-tv55']).toMatchObject({
      decision: 'reject',
      disagreement: [
        { checker: 'deal-verifier', decision: 'reject' },
        { checker: 'merchant-risk', decision: 'pass' },
      ],
    });
    for (const id of ['d-tv55', 'e-tv55']) {
      expect(byOffer[id]).toMatchObject({
        decision: 'reject',
        disagreement: [
          { checker: 'deal-verifier', decision: 'pass' },
          { checker: 'merchant-risk', decision: 'reject' },
        ],
      });
    }
    expect(byOffer['c-tv55']?.reasons[0]?.text).toBe('Reviewed: the offer is reject.');
    // Each review comes after both of its verdicts.
    const at = (test: (e: PrickleEvent) => boolean) => events.findIndex(test);
    for (const id of Object.keys(byOffer)) {
      const lastVerdict = Math.max(
        ...events.flatMap((e, i) =>
          e.type === 'verdict.ready' && e.verdict.offerId === id ? [i] : [],
        ),
      );
      expect(at((e) => e.type === 'review.done' && e.offerId === id)).toBeGreaterThan(lastVerdict);
    }
    expect(result.outcome).toEqual({ kind: 'paid', offerId: 'b-tv55' });
  });

  it("drops a reviewer explanation with an invented number and keeps the code's wording", async () => {
    const { result, events } = await demo(scriptedModel({ reviewText: 'It would cost €999.00.' }));
    expect(
      events.filter((e) => e.type === 'grounding.rejected' && e.agent === 'reviewer'),
    ).not.toEqual([]);
    const c = result.reviews.find((r) => r.offerId === 'c-tv55');
    expect(c?.reasons[0]?.text).toBe(
      'The checkers disagree; deal-verifier found fake discount, so the offer is reject.',
    );
  });
});
