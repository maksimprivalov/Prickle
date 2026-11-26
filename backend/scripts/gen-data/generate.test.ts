import { describe, expect, it } from 'vitest';
import { CheckoutLineKind } from '@core/offers';
import { MANDATE_RECORD_ID } from '@core/records';
import { TrapKind } from '@core/traps';
import { DEMO_MANDATE, generate, type Dataset } from './generate';

const data = generate();

function offer(d: Dataset, offerId: string) {
  const found = d.offers.find((o) => o.offerId === offerId);
  if (!found) throw new Error(`no offer ${offerId}`);
  return found;
}
function checkout(d: Dataset, offerId: string) {
  const found = d.checkouts.find((c) => c.offerId === offerId);
  if (!found) throw new Error(`no checkout ${offerId}`);
  return found;
}
const history = (d: Dataset, offerId: string) =>
  d.priceHistory.filter((r) => r.offerId === offerId);
const trapsOn = (d: Dataset, offerId: string) =>
  d.traps.filter((t) => t.offerId === offerId).map((t) => t.trap);

/** Lowest price in the 30 days before the reduction. A stand-in, not core/deal. */
function lowestBefore(d: Dataset, offerId: string, reductionStart: string): number {
  const start = new Date(`${reductionStart}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  const from = start.toISOString().slice(0, 10);
  const window = history(d, offerId).filter((r) => r.date >= from && r.date < reductionStart);
  return Math.min(...window.map((r) => r.price));
}

describe('generate', () => {
  it('is byte-identical for the same seed', () => {
    expect(JSON.stringify(generate())).toBe(JSON.stringify(data));
  });

  it('builds 5 stores, 40 offers and 60 daily rows per offer ending on Black Friday', () => {
    expect(data.stores).toHaveLength(5);
    expect(data.offers).toHaveLength(40);
    expect(data.checkouts).toHaveLength(40);
    for (const o of data.offers) {
      const rows = history(data, o.offerId);
      expect(rows).toHaveLength(60);
      expect(rows[0]?.date).toBe('2026-09-29');
      expect(rows[59]?.date).toBe('2026-11-27');
    }
  });

  it('gives every record a unique id, and every trap cites only records that exist', () => {
    const ids = [...data.stores, ...data.offers, ...data.priceHistory, ...data.checkouts].map(
      (r) => r.recordId,
    );
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set([...ids, MANDATE_RECORD_ID]);
    for (const t of data.traps) for (const id of t.recordIds) expect(known.has(id)).toBe(true);
  });

  it('states checkout totals that equal the sum of their lines', () => {
    for (const c of data.checkouts) {
      expect(c.total).toBe(c.lines.reduce((total, line) => total + line.amount, 0));
    }
  });

  it('plants every trap type at least once and keeps honest deals', () => {
    for (const kind of Object.values(TrapKind)) {
      expect(data.traps.some((t) => t.trap === kind)).toBe(true);
    }
    const honest = data.offers.filter((o) => trapsOn(data, o.offerId).length === 0);
    expect(honest.length).toBeGreaterThanOrEqual(10);
  });
});

describe('the demo story', () => {
  it('Store B: €585, was €699 every day before the cut, 30-day refunds, trusted, no traps', () => {
    const b = offer(data, 'b-tv55');
    expect(b.price).toBe(58_500);
    expect(b.wasPrice).toBe(69_900);
    expect(checkout(data, 'b-tv55').total).toBe(58_500);
    const before = history(data, 'b-tv55').filter((r) => r.date < '2026-11-20');
    expect(before.every((r) => r.price === 69_900)).toBe(true);
    expect(data.stores.find((s) => s.storeId === 'b')).toMatchObject({
      trusted: true,
      returnPolicy: { kind: 'refund', days: 30 },
    });
    expect(trapsOn(data, 'b-tv55')).toEqual([]);
  });

  it('Store B is the only 55-inch TV with no trap, so it is the one the guard can pay', () => {
    const clean = data.offers.filter(
      (o) =>
        o.category === DEMO_MANDATE.category &&
        o.screenInches === DEMO_MANDATE.screenInches &&
        trapsOn(data, o.offerId).length === 0,
    );
    expect(clean.map((o) => o.offerId)).toEqual(['b-tv55']);
  });

  it('Store C: €599 in October, €649 from 1 November, "cut" to €599: a fake discount', () => {
    const c = offer(data, 'c-tv55');
    expect(c.price).toBe(59_900);
    expect(c.wasPrice).toBe(64_900);
    const rows = history(data, 'c-tv55');
    const october = rows.filter((r) => r.date.startsWith('2026-10'));
    expect(october.every((r) => r.price === 59_900)).toBe(true);
    const raised = rows.filter((r) => r.date >= '2026-11-01' && r.date < '2026-11-20');
    expect(raised.every((r) => r.price === 64_900)).toBe(true);
    expect(trapsOn(data, 'c-tv55')).toEqual([TrapKind.FakeDiscount]);
  });

  it('Store D: €599 listed, €648 at checkout because of a €49 service fee', () => {
    expect(offer(data, 'd-tv55').price).toBe(59_900);
    const co = checkout(data, 'd-tv55');
    expect(co.total).toBe(64_800);
    expect(co.lines.find((l) => l.kind === CheckoutLineKind.ServiceFee)?.amount).toBe(4_900);
    expect(trapsOn(data, 'd-tv55')).toContain(TrapKind.HiddenFee);
  });

  // Mirrors the table in data/README.md: change both together.
  it.each([
    ['a-tv55', 74_900, 74_900, [TrapKind.OverBudget]],
    ['b-tv55', 58_500, 58_500, []],
    ['c-tv55', 59_900, 59_900, [TrapKind.FakeDiscount]],
    ['d-tv55', 59_900, 64_800, [TrapKind.HiddenFee, TrapKind.OverBudget]],
    ['e-tv55', 55_900, 55_900, [TrapKind.FakeScarcity, TrapKind.NoRefundPolicy]],
  ])('%s: listed %i, %i at checkout, traps as in data/README.md', (id, price, total, traps) => {
    expect(offer(data, id).price).toBe(price);
    expect(checkout(data, id).total).toBe(total);
    expect([...trapsOn(data, id)].sort()).toEqual([...traps].sort());
  });
});

describe('the answer key matches the data', () => {
  it('marks a fake discount exactly where "was" is above the 30-day low', () => {
    for (const o of data.offers) {
      if (o.wasPrice === undefined || o.reductionStart === undefined) continue;
      const fake = o.wasPrice > lowestBefore(data, o.offerId, o.reductionStart);
      expect(trapsOn(data, o.offerId).includes(TrapKind.FakeDiscount)).toBe(fake);
    }
  });

  it('marks a hidden fee exactly where the checkout has a service-fee line', () => {
    for (const c of data.checkouts) {
      const hasFee = c.lines.some((l) => l.kind === CheckoutLineKind.ServiceFee);
      expect(trapsOn(data, c.offerId).includes(TrapKind.HiddenFee)).toBe(hasFee);
    }
  });

  it('marks over budget exactly for 55-inch TVs whose checkout total exceeds the mandate', () => {
    for (const o of data.offers) {
      const over =
        o.category === 'tv' &&
        o.screenInches === 55 &&
        checkout(data, o.offerId).total > DEMO_MANDATE.maxTotal;
      expect(trapsOn(data, o.offerId).includes(TrapKind.OverBudget)).toBe(over);
    }
  });

  it('marks fake scarcity and no refund policy on every offer of the store that does both', () => {
    const e = data.offers.filter((o) => o.storeId === 'e');
    for (const o of e) {
      expect(trapsOn(data, o.offerId)).toEqual(
        expect.arrayContaining([TrapKind.FakeScarcity, TrapKind.NoRefundPolicy]),
      );
    }
    const others = data.traps.filter(
      (t) =>
        t.storeId !== 'e' &&
        (t.trap === TrapKind.FakeScarcity || t.trap === TrapKind.NoRefundPolicy),
    );
    expect(others).toEqual([]);
  });
});
