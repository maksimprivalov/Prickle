import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fixtures } from '@test/fixtures';
import { PrickleEvent } from '@core/events';
import { Mandate } from '@core/mandate';
import { usdcUnits } from '@core/money';
import { createMockWallet } from '@payments/mock-wallet';
import type { ModelDriver } from '@runtime/plain/plain-runtime';
import { createPlainRuntime } from '@runtime/plain/plain-runtime';
import { RunLogLine, createMemoryRunLog } from '@runtime/run-log';
import { createMockStoresApp } from '../mock-stores/app';
import { loadFixtures } from '../mock-stores/fixtures';
import { runSession, type SessionState } from './run-session';

// The whole demo session on the plain runtime: Tara's real mock stores in-process, a scripted
// model in place of the LLM. Checks the 20:00 milestone: five scouts → checkers → guard → pay.

const ScoutHit = z.object({
  ok: z.literal(true),
  offers: z.array(z.object({ recordId: z.string() })),
});
const OfferMessage = z.object({ recordId: z.string(), storeId: z.string(), offerId: z.string() });
const BudgetMessage = z.object({
  candidates: z.array(
    z.object({
      offerId: z.string(),
      checkoutTotal: z.object({ amount: z.number() }).nullable(),
      verdicts: z.array(z.object({ decision: z.string() })),
    }),
  ),
});
// A call the guard blocked before pay() ran comes back as { blocked, reason }, without a status.
const PayResult = z.object({ status: z.string().optional() }).loose();

/** What a sensible model would do, per agent. The budget step tries the cheapest first. */
const scriptedModel =
  (options: { budgetIgnoresVerdicts?: boolean } = {}): ModelDriver =>
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
      await callTool('price_history', { storeId: offer.storeId, offerId: offer.offerId });
      return { conclusion: 'real', text: 'Looks like a real discount.', sources: [offer.recordId] };
    }
    if (agent.name === 'merchant-risk') {
      const offer = OfferMessage.parse(
        JSON.parse(message.split('\n')[0]?.slice('Offer: '.length) ?? ''),
      );
      const Rec = z.object({ recordId: z.string() });
      const id = (out: unknown, key: 'checkout' | 'store') =>
        key === 'checkout'
          ? z.object({ checkout: Rec }).parse(out).checkout.recordId
          : z.object({ store: Rec }).parse(out).store.recordId;
      const catalog = z
        .object({ offers: z.array(z.object({ recordId: z.string() })) })
        .parse(await callTool('store_catalog', { storeId: offer.storeId }));
      return {
        checkout: id(
          await callTool('checkout_total', { storeId: offer.storeId, offerId: offer.offerId }),
          'checkout',
        ),
        store: id(await callTool('store_profile', { storeId: offer.storeId }), 'store'),
        storeOffers: catalog.offers.map((o) => o.recordId),
        explanations: [],
      };
    }
    if (agent.name === 'budget') {
      const { candidates } = BudgetMessage.parse(JSON.parse(message));
      const ranked = candidates
        .filter((c) => c.checkoutTotal !== null)
        .filter(
          (c) => options.budgetIgnoresVerdicts || c.verdicts.every((v) => v.decision === 'pass'),
        )
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
});
