import { describe, expect, it } from 'vitest';
import { checkoutOf, fixtures, historyOf, offer, storeOf } from '@test/fixtures';
import type { GuardDecision } from '../events';
import { cents, usdcUnits } from '../money';
import type { CheckoutBreakdown, StoreProfile } from '../offers';
import { MANDATE_RECORD_ID } from '../records';
import type { Verdict } from '../verdicts';
import { checkPayment, type PaymentCheck } from './check-payment';

const passVerdicts = (offerId: string): Verdict[] =>
  (['deal-verifier', 'merchant-risk'] as const).map((checker) => ({
    offerId,
    checker,
    decision: 'pass',
    reasons: [{ code: 'store_looks_sound', text: 'Looks fine.', sources: [`${offerId}-of-1`] }],
  }));

/**
 * The demo mandate, the offer's own records, both verdicts, nothing spent. The wallet holds
 * 1000 USDC so each test sees one rule; with exactly the cap, an over-budget offer is also
 * `insufficient_balance` (tested below).
 */
function checkFor(offerId: string, overrides: Partial<PaymentCheck> = {}): PaymentCheck {
  const o = offer(offerId);
  return {
    mandate: fixtures.mandate,
    offer: o,
    checkout: checkoutOf(offerId),
    store: storeOf(o.storeId),
    history: historyOf(offerId),
    verdicts: passVerdicts(offerId),
    spent: { amount: cents(0), recordId: MANDATE_RECORD_ID },
    balance: { amount: usdcUnits(1_000_000_000), recordId: 'wallet-balance-1' },
    ...overrides,
  };
}

const codes = (decision: GuardDecision) =>
  decision.allow ? [] : decision.reasons.map((r) => r.code);

describe('checkPayment() on the demo: 55-inch TV, at most €600, real discount, trusted', () => {
  it('pays Store B: €585 at checkout, real discount, trusted', () => {
    expect(checkPayment(checkFor('b-tv55'))).toEqual({ allow: true });
  });

  it('denies Store A: €749 is over the €600 mandate', () => {
    expect(codes(checkPayment(checkFor('a-tv55')))).toEqual(['over_mandate']);
  });

  it('denies Store C: the discount fails the 30-day rule', () => {
    const decision = checkPayment(checkFor('c-tv55'));
    expect(codes(decision)).toEqual(['discount_not_verified']);
    const compared = decision.allow ? [] : (decision.reasons[0]?.compared ?? []);
    expect(compared.map((c) => [c.label, c.value.amount])).toEqual([
      ['"Was" price', 64900],
      ['Lowest price in the 30 days before', 59900],
    ]);
    expect(compared[0]?.value.recordId).toBe('c-tv55-of-1');
  });

  it('denies Store D on the checkout total €648, not the €599 list price', () => {
    expect(offer('d-tv55').price).toBe(59900);
    const decision = checkPayment(checkFor('d-tv55'));
    expect(codes(decision)).toEqual(['over_mandate']);
    expect(!decision.allow && decision.reasons[0]?.compared[0]).toEqual({
      label: 'Checkout total',
      value: { amount: 64800, recordId: 'd-tv55-co-1' },
    });
  });

  it('denies Store E: not a trusted store', () => {
    expect(codes(checkPayment(checkFor('e-tv55')))).toEqual(['untrusted_store']);
  });
});

describe('checkPayment(): the budget', () => {
  const totalOf = (amount: number): CheckoutBreakdown => ({
    ...checkoutOf('b-tv55'),
    total: cents(amount),
  });

  it('allows a checkout total exactly equal to the mandate', () => {
    expect(checkPayment(checkFor('b-tv55', { checkout: totalOf(60000) }))).toEqual({ allow: true });
  });

  it('denies when the checkout total exceeds the mandate by one cent', () => {
    expect(codes(checkPayment(checkFor('b-tv55', { checkout: totalOf(60001) })))).toEqual([
      'over_mandate',
    ]);
  });

  it('counts money already spent in the session', () => {
    const spent = (amount: number) => ({ amount: cents(amount), recordId: 'payment-1' });
    expect(checkPayment(checkFor('b-tv55', { spent: spent(1500) })).allow).toBe(true);
    const decision = checkPayment(checkFor('b-tv55', { spent: spent(1501) }));
    expect(codes(decision)).toEqual(['over_mandate']);
    expect(!decision.allow && decision.reasons[0]?.sources).toContain('payment-1');
  });

  it('with a wallet funded to the cap, an over-budget offer is also short of balance', () => {
    const balance = { amount: usdcUnits(600_000_000), recordId: 'wallet-balance-1' };
    expect(codes(checkPayment(checkFor('a-tv55', { balance })))).toEqual([
      'over_mandate',
      'insufficient_balance',
    ]);
  });

  it('denies when the wallet holds less than the checkout total', () => {
    const balance = { amount: usdcUnits(584_999_999), recordId: 'wallet-balance-1' };
    expect(codes(checkPayment(checkFor('b-tv55', { balance })))).toEqual(['insufficient_balance']);
  });
});

describe('checkPayment(): the rest of the mandate', () => {
  it('denies an offer that is not what the user asked for', () => {
    const soundbar = offer('b-soundbar');
    expect(
      codes(
        checkPayment(
          checkFor('b-soundbar', {
            checkout: { ...checkoutOf('b-soundbar'), total: cents(10000) },
            store: storeOf(soundbar.storeId),
          }),
        ),
      ),
    ).toContain('product_mismatch');
  });

  it('applies the 30-day rule only when the mandate asks for a real discount', () => {
    const mandate = { ...fixtures.mandate, requireRealDiscount: false };
    expect(checkPayment(checkFor('c-tv55', { mandate }))).toEqual({ allow: true });
  });

  it('applies the trusted-store rule only when the mandate asks for it', () => {
    const mandate = { ...fixtures.mandate, trustedStoresOnly: false };
    expect(checkPayment(checkFor('e-tv55', { mandate }))).toEqual({ allow: true });
  });

  it('lists every reason at once', () => {
    const mandate = { ...fixtures.mandate, maxTotal: cents(50000) };
    expect(codes(checkPayment(checkFor('e-tv55', { mandate })))).toEqual([
      'over_mandate',
      'untrusted_store',
    ]);
  });
});

describe('checkPayment() fails closed', () => {
  it.each([
    ['missing', undefined],
    ['without a maximum', { ...fixtures.mandate, maxTotal: undefined }],
    ['with a fractional maximum', { ...fixtures.mandate, maxTotal: 600.5 }],
    ['with a zero maximum', { ...fixtures.mandate, maxTotal: 0 }],
  ])('denies when the mandate is %s', (_label, mandate) => {
    expect(codes(checkPayment(checkFor('b-tv55', { mandate })))).toEqual(['invalid_mandate']);
  });

  it('denies when a required verdict is missing', () => {
    const verdicts = passVerdicts('b-tv55').filter((v) => v.checker === 'deal-verifier');
    const decision = checkPayment(checkFor('b-tv55', { verdicts }));
    expect(codes(decision)).toEqual(['missing_verdict']);
    expect(!decision.allow && decision.reasons[0]?.message).toContain('merchant-risk');
  });

  it("does not count another offer's verdicts", () => {
    expect(codes(checkPayment(checkFor('b-tv55', { verdicts: passVerdicts('c-tv55') })))).toEqual([
      'missing_verdict',
    ]);
  });

  it('denies when the records belong to different offers', () => {
    const decision = checkPayment(checkFor('b-tv55', { checkout: checkoutOf('d-tv55') }));
    expect(codes(decision)).toEqual(['guard_error']);
  });

  it('denies when the store profile is for another store', () => {
    const store: StoreProfile = storeOf('a');
    expect(codes(checkPayment(checkFor('b-tv55', { store })))).toEqual(['guard_error']);
  });

  it('denies malformed input, e.g. a float price', () => {
    const checkout = { ...checkoutOf('b-tv55'), total: 585.5 } as unknown as CheckoutBreakdown;
    expect(codes(checkPayment(checkFor('b-tv55', { checkout })))).toEqual(['guard_error']);
  });

  it('denies when reading the input throws', () => {
    const exploding = {
      ...checkFor('b-tv55'),
      get offer(): never {
        throw new Error('boom');
      },
    };
    expect(codes(checkPayment(exploding))).toEqual(['guard_error']);
  });

  it('ignores anything extra an agent might add to widen the mandate', () => {
    const offerWithClaim = { ...offer('a-tv55'), maxTotal: 100_000, approvedBy: 'reviewer' };
    expect(codes(checkPayment(checkFor('a-tv55', { offer: offerWithClaim })))).toEqual([
      'over_mandate',
    ]);
  });
});
