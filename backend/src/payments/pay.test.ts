import { describe, expect, it, vi } from 'vitest';
import { checkoutOf, fixtures, historyOf, offer, storeOf } from '@test/fixtures';
import { PrickleEvent } from '@core/events';
import { cents, usdcUnits } from '@core/money';
import type { Verdict } from '@core/verdicts';
import { createRecordRegistry } from '@runtime/record-registry';
import { createLedger } from './ledger';
import { createMockWallet } from './mock-wallet';
import {
  createGuardInterceptor,
  createPayTool,
  lookupFromRecords,
  type OfferRecords,
  type PayOutput,
  type PaySession,
} from './pay';
import type { Wallet } from './wallet';

const recordsOf = (offerId: string): OfferRecords => {
  const o = offer(offerId);
  return {
    offer: o,
    checkout: checkoutOf(offerId),
    store: storeOf(o.storeId),
    history: historyOf(offerId),
  };
};

const passVerdicts = (offerId: string): Verdict[] =>
  (['deal-verifier', 'merchant-risk'] as const).map((checker) => ({
    offerId,
    checker,
    decision: 'pass',
    reasons: [{ code: 'store_looks_sound', text: 'Looks fine.', sources: [`${offerId}-of-1`] }],
  }));

function session(
  overrides: Partial<PaySession> = {},
  offers: Readonly<Record<string, OfferRecords>> = {
    'b-tv55': recordsOf('b-tv55'),
    'd-tv55': recordsOf('d-tv55'),
  },
) {
  const wallet = createMockWallet(usdcUnits(600_000_000));
  const transfer = vi.spyOn(wallet, 'transfer');
  const events: PrickleEvent[] = [];
  const s: PaySession = {
    sessionId: 's-1',
    mandate: () => fixtures.mandate,
    lookup: (id) => offers[id],
    verdicts: passVerdicts,
    wallet,
    ledger: createLedger(),
    records: createRecordRegistry(),
    publish: (e) => events.push(PrickleEvent.parse(e)),
    clock: () => new Date('2026-11-27T10:00:00.000Z'),
    ...overrides,
  };
  return { s, wallet, transfer, events, pay: createPayTool(s) };
}

const codesOf = (result: PayOutput | undefined) =>
  result?.status === 'denied' ? result.reasons.map((r) => r.code) : [];

const ctx = { sessionId: 's-1', agent: 'budget', records: createRecordRegistry() };

describe('pay()', () => {
  it('pays Store B its checkout total, 585 test USDC, and reports the spend', async () => {
    const { pay, transfer, events, s } = session();
    expect(await pay.run({ offerId: 'b-tv55' }, ctx)).toEqual({
      status: 'paid',
      offerId: 'b-tv55',
      recordId: 'b-tv55-pay-1',
      amount: 585_000_000,
      signature: 'mock-1',
    });
    expect(transfer).toHaveBeenCalledOnce();
    expect(transfer).toHaveBeenCalledWith({
      storeId: 'b',
      amount: 585_000_000,
      reference: 's-1:b-tv55',
    });
    expect(events.map((e) => e.type)).toEqual(['guard.decided', 'payment.settled']);
    expect(events[1]).toMatchObject({
      amount: 585_000_000,
      spent: 585_000_000,
      cap: 600_000_000,
      wallet: 'mock',
    });
    expect(s.ledger.spent()).toEqual({ amount: 58500, recordId: 'b-tv55-pay-1' });
  });

  it('never reaches the wallet when the guard denies (Store D, €648 at checkout)', async () => {
    const { pay, transfer, events } = session();
    const result = await pay.run({ offerId: 'd-tv55' }, ctx);
    // The wallet holds exactly the cap, so €648 is also more than it holds.
    expect(codesOf(result)).toEqual(['over_mandate', 'insufficient_balance']);
    expect(transfer).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({ type: 'guard.decided', agent: 'guard', offerId: 'd-tv55' }),
    ]);
  });

  it('denies an offer whose records are not in this run', async () => {
    const { pay, transfer } = session();
    const result = await pay.run({ offerId: 'x-unknown' }, ctx);
    expect(result).toMatchObject({ status: 'denied', reasons: [{ code: 'guard_error' }] });
    expect(transfer).not.toHaveBeenCalled();
  });

  it('denies when the mandate in state is not valid', async () => {
    const { pay, transfer } = session({ mandate: () => ({ maxTotal: 600.5 }) });
    expect(await pay.run({ offerId: 'b-tv55' }, ctx)).toMatchObject({
      status: 'denied',
      reasons: [{ code: 'invalid_mandate' }],
    });
    expect(transfer).not.toHaveBeenCalled();
  });

  it('pays only once when asked twice for the same offer', async () => {
    const { pay, transfer } = session();
    const first = await pay.run({ offerId: 'b-tv55' }, ctx);
    const again = await pay.run({ offerId: 'b-tv55' }, ctx);
    expect(again).toEqual(first);
    expect(transfer).toHaveBeenCalledOnce();
  });

  it('runs concurrent payments one at a time, so the second sees the first', async () => {
    // Two €400 offers, each fine alone, together over the €600 mandate.
    const cheap = (offerId: string): OfferRecords => {
      const base = recordsOf('b-tv55');
      return {
        offer: { ...base.offer, offerId, price: cents(40000) },
        checkout: { ...base.checkout, offerId, recordId: `${offerId}-co-1`, total: cents(40000) },
        store: base.store,
        history: base.history.map((r) => ({ ...r, offerId })),
      };
    };
    const { pay, transfer } = session(
      {},
      { 'b-tv55x': cheap('b-tv55x'), 'b-tv55y': cheap('b-tv55y') },
    );
    const results = await Promise.all([
      pay.run({ offerId: 'b-tv55x' }, ctx),
      pay.run({ offerId: 'b-tv55y' }, ctx),
    ]);
    expect(results.map((r) => r.status)).toEqual(['paid', 'denied']);
    expect(codesOf(results[1])).toEqual(['over_mandate', 'insufficient_balance']);
    expect(transfer).toHaveBeenCalledOnce();
  });

  it('reports a transfer that surely did not happen as payment.failed and records nothing', async () => {
    const broken: Wallet = {
      kind: 'devnet',
      balance: () => Promise.resolve(usdcUnits(600_000_000)),
      transfer: () =>
        Promise.resolve({ ok: false, detail: 'no devnet address for store b', maybeMoved: false }),
    };
    const { pay, events, s } = session({ wallet: broken });
    expect(await pay.run({ offerId: 'b-tv55' }, ctx)).toMatchObject({ status: 'failed' });
    expect(events.at(-1)).toMatchObject({ type: 'payment.failed', wallet: 'devnet' });
    expect(s.ledger.entries()).toEqual([]);
  });

  it('counts a transfer that may have gone through as spent, and never retries it', async () => {
    // A devnet confirmation timeout: the transaction may be on chain even though we got an error.
    const transfer = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        detail: 'devnet transfer failed: confirmation timed out',
        maybeMoved: true,
      }),
    );
    const uncertain: Wallet = {
      kind: 'devnet',
      balance: () => Promise.resolve(usdcUnits(1_000_000_000)),
      transfer,
    };
    const base = recordsOf('b-tv55');
    const small: OfferRecords = {
      ...base,
      offer: { ...base.offer, offerId: 'b-tv55z' },
      checkout: {
        ...base.checkout,
        offerId: 'b-tv55z',
        recordId: 'b-tv55z-co-1',
        total: cents(10000),
      },
      history: base.history.map((r) => ({ ...r, offerId: 'b-tv55z' })),
    };
    const { pay, s } = session({ wallet: uncertain }, { 'b-tv55': base, 'b-tv55z': small });

    expect(await pay.run({ offerId: 'b-tv55' }, ctx)).toMatchObject({ status: 'failed' });
    expect(s.ledger.spent().amount).toBe(58500);
    // €585 may be gone, so another €100 no longer fits the €600 mandate.
    expect(codesOf(await pay.run({ offerId: 'b-tv55z' }, ctx))).toEqual(['over_mandate']);
    // Asking again for the first offer does not send a second transfer.
    const again = await pay.run({ offerId: 'b-tv55' }, ctx);
    expect(again.status === 'failed' && again.detail).toContain('may have gone through');
    expect(transfer).toHaveBeenCalledOnce();
  });

  it('gives every balance read its own record id, also when two run at once', async () => {
    const { s, pay } = session();
    await Promise.all([
      pay.run({ offerId: 'd-tv55' }, ctx),
      createGuardInterceptor(s).decide({
        agent: 'budget',
        loopId: 'budget#1',
        tool: 'pay',
        input: { offerId: 'd-tv55' },
      }),
    ]);
    const ids = s.records.all().map((r) => r.recordId);
    expect(ids.sort()).toEqual(['wallet-balance-1', 'wallet-balance-2']);
  });
});

describe('the guard interceptor in front of pay()', () => {
  const call = (offerId: string) => ({
    agent: 'budget',
    loopId: 'budget#1',
    tool: 'pay',
    input: { offerId },
  });

  it('blocks Store D before pay() runs, and says why', async () => {
    const { s, events } = session();
    const decision = await createGuardInterceptor(s).decide(call('d-tv55'));
    expect(decision).toMatchObject({ allow: false });
    expect(!decision.allow && decision.reason).toContain('€648.00');
    expect(events.map((e) => e.type)).toEqual(['guard.decided']);
  });

  it('lets Store B through without publishing (pay() decides again and publishes)', async () => {
    const { s, events } = session();
    expect(await createGuardInterceptor(s).decide(call('b-tv55'))).toEqual({ allow: true });
    expect(events).toEqual([]);
  });

  it('matches only the pay tool', () => {
    const { s } = session();
    const guard = createGuardInterceptor(s);
    expect(guard.matches(call('b-tv55'))).toBe(true);
    expect(guard.matches({ ...call('b-tv55'), tool: 'price_history' })).toBe(false);
  });
});

describe('lookupFromRecords()', () => {
  it("finds an offer's records among what tools registered", () => {
    const records = createRecordRegistry();
    const b = recordsOf('b-tv55');
    records.add([b.offer, b.checkout, b.store, ...b.history, ...recordsOf('c-tv55').history]);
    expect(lookupFromRecords(records)('b-tv55')).toEqual(b);
  });

  it('returns nothing when the checkout was never fetched', () => {
    const records = createRecordRegistry();
    const b = recordsOf('b-tv55');
    records.add([b.offer, b.store]);
    expect(lookupFromRecords(records)('b-tv55')).toBeUndefined();
  });
});
