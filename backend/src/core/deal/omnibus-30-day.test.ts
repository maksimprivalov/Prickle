import { describe, expect, it } from 'vitest';
import { fixtures, historyOf, offer } from '@test/fixtures';
import { cents } from '../money';
import type { Offer, PriceHistoryRow } from '../offers';
import { addDays, daysBefore } from './iso-date';
import { omnibus30Day } from './omnibus-30-day';

const listing = (overrides: Partial<Offer> = {}): Offer => ({
  recordId: 'x-tv55-of-1',
  offerId: 'x-tv55',
  storeId: 'a',
  title: 'Test TV',
  category: 'tv',
  price: cents(50000),
  wasPrice: cents(60000),
  reductionStart: '2026-11-20',
  ...overrides,
});

/** One row per day for the `days` days before 20 Nov, priced by `priceOn(dayIndex)`. */
const historyFor = (days: number, priceOn: (i: number) => number): PriceHistoryRow[] =>
  daysBefore('2026-11-20', days).map((date, i) => ({
    recordId: `x-tv55-ph-${1000 + i}`,
    offerId: 'x-tv55',
    date,
    price: cents(priceOn(i)),
  }));

describe('omnibus30Day() on the demo data', () => {
  it('rejects Store C: €599 in late October is below the "was" €649', () => {
    const result = omnibus30Day(offer('c-tv55'), historyOf('c-tv55'));
    expect(result).toMatchObject({
      decision: 'reject',
      code: 'fake_discount',
      wasPrice: { amount: 64900, recordId: 'c-tv55-of-1' },
      lowest30: { amount: 59900 },
    });
    // The rows that prove it are the €599 days inside the window (the trap's answer key).
    const trap = fixtures.history.filter((r) => r.offerId === 'c-tv55' && r.price === 59900);
    expect(result.code === 'fake_discount' && result.lowestRows).toEqual(
      trap.filter((r) => r.date >= '2026-10-21' && r.date < '2026-11-20').map((r) => r.recordId),
    );
  });

  it('passes Store B: €699 every day of the 30 before the cut', () => {
    expect(omnibus30Day(offer('b-tv55'), historyOf('b-tv55'))).toMatchObject({
      decision: 'pass',
      code: 'real_discount',
      wasPrice: { amount: 69900 },
      lowest30: { amount: 69900 },
    });
  });

  it.each(['a-tv55', 'd-tv55', 'e-tv55'])('passes the real discount at %s', (id) => {
    expect(omnibus30Day(offer(id), historyOf(id)).code).toBe('real_discount');
  });

  it('cites the offer and exactly the 30 window rows', () => {
    const result = omnibus30Day(offer('b-tv55'), historyOf('b-tv55'));
    expect(result.sources).toHaveLength(31);
    expect(result.sources[0]).toBe('b-tv55-of-1');
  });
});

describe('omnibus30Day() edge cases', () => {
  it('calls a history shorter than 30 days unverifiable, not real', () => {
    const result = omnibus30Day(
      listing(),
      historyFor(29, () => 60000),
    );
    expect(result).toMatchObject({ decision: 'unverifiable', code: 'history_too_short' });
    expect(result.code === 'history_too_short' && result.missingDays).toEqual(['2026-10-21']);
  });

  it('calls a history with one day missing inside the window unverifiable', () => {
    const rows = historyFor(30, () => 60000).filter((r) => r.date !== '2026-11-05');
    expect(omnibus30Day(listing(), rows).decision).toBe('unverifiable');
  });

  it('passes at the exact boundary: "was" equal to the 30-day low', () => {
    expect(
      omnibus30Day(
        listing(),
        historyFor(30, () => 60000),
      ).code,
    ).toBe('real_discount');
  });

  it('rejects when the "was" price is one cent above the 30-day low', () => {
    const rows = historyFor(30, (i) => (i === 3 ? 59999 : 60000));
    expect(omnibus30Day(listing(), rows)).toMatchObject({
      code: 'fake_discount',
      lowest30: { amount: 59999, recordId: 'x-tv55-ph-1003' },
    });
  });

  it('ignores prices from before the window and from the reduction itself', () => {
    const before = {
      recordId: 'x-tv55-ph-900',
      offerId: 'x-tv55',
      date: '2026-10-01',
      price: cents(100),
    };
    const during = {
      recordId: 'x-tv55-ph-901',
      offerId: 'x-tv55',
      date: '2026-11-20',
      price: cents(100),
    };
    const rows = [before, ...historyFor(30, () => 60000), during];
    expect(omnibus30Day(listing(), rows).code).toBe('real_discount');
  });

  it('uses the cheaper of two rows for the same day', () => {
    const rows = historyFor(30, () => 60000);
    const cheaper = {
      ...rows[10],
      recordId: 'x-tv55-ph-2000',
      price: cents(55000),
    } as PriceHistoryRow;
    expect(omnibus30Day(listing(), [...rows, cheaper])).toMatchObject({
      code: 'fake_discount',
      lowest30: { amount: 55000, recordId: 'x-tv55-ph-2000' },
    });
  });

  it("ignores another offer's rows", () => {
    const other = historyFor(30, () => 100).map((r) => ({ ...r, offerId: 'y-tv55' }));
    expect(omnibus30Day(listing(), [...other, ...historyFor(30, () => 60000)]).code).toBe(
      'real_discount',
    );
  });

  it('rejects a "was" price that is not above the current price', () => {
    const result = omnibus30Day(
      listing({ price: cents(60000) }),
      historyFor(30, () => 60000),
    );
    expect(result.code).toBe('fake_discount');
  });

  it('reports no discount claimed when there is no "was" price', () => {
    const plain = listing({ wasPrice: undefined, reductionStart: undefined });
    expect(omnibus30Day(plain, [])).toEqual({
      decision: 'pass',
      code: 'no_discount_claimed',
      sources: ['x-tv55-of-1'],
    });
  });
});

describe('iso dates', () => {
  it('crosses month ends in UTC', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(daysBefore('2026-11-20', 30)[0]).toBe('2026-10-21');
    expect(daysBefore('2026-11-20', 30).at(-1)).toBe('2026-11-19');
  });

  it('throws on a non-date', () => {
    expect(() => addDays('20 Nov', 1)).toThrow(RangeError);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});
