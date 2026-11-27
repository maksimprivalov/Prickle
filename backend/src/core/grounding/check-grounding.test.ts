import { describe, expect, it } from 'vitest';
import { checkoutOf, historyOf, offer, storeOf } from '@test/fixtures';
import { checkGrounding } from './check-grounding';

// Store C's TV: €599 now, "was" €649, €599 throughout late October (fixtures).
const c = offer('c-tv55');
const cHistory = historyOf('c-tv55');
const oct25 = cHistory.find((r) => r.date === '2026-10-25');
const nov05 = cHistory.find((r) => r.date === '2026-11-05');
if (!oct25 || !nov05) throw new Error('fixture rows missing');
const records = [c, ...cHistory, checkoutOf('d-tv55'), storeOf('e'), offer('e-tv55')];

const explain = (text: string, sources: string[]) => ({ conclusion: 'fake', text, sources });

describe('checkGrounding()', () => {
  it('passes a number that matches a cited record', () => {
    const out = explain('The store says it was €649.00, but it sold for €599.00 on 2026-10-25.', [
      c.recordId,
      oct25.recordId,
    ]);
    expect(checkGrounding(out, records)).toEqual({ ok: true });
  });

  it('rejects "was €649" when the record says €639', () => {
    const wrong = { ...c, wasPrice: 63900, recordId: 'x-tv55-of-1' };
    const out = explain('It was €649.00 before.', [wrong.recordId]);
    expect(checkGrounding(out, [wrong])).toEqual({ ok: false, unsourced: ['649.00'] });
  });

  it.each(['599', '599.00', '€599', '€599,00', '599,00 EUR', '€ 599.00'])(
    'reads "%s" as the same €599.00',
    (written) => {
      expect(checkGrounding(explain(`It sold for ${written}.`, [c.recordId]), records).ok).toBe(
        true,
      );
    },
  );

  it('reads thousands separators either way, without rounding', () => {
    const tv = { ...c, recordId: 'y-tv77-of-1', price: 129900 };
    for (const written of ['1,299.00', '1.299,00', '1299']) {
      expect(checkGrounding(explain(`Now ${written}.`, [tv.recordId]), [tv]).ok).toBe(true);
    }
    expect(checkGrounding(explain('Now 1,299.50.', [tv.recordId]), [tv]).ok).toBe(false);
  });

  it('rejects a number that is only in a record the output does not cite', () => {
    // €648.00 is Store D's checkout total, but the output cites only Store C's offer.
    const out = explain('The total is €648.00.', [c.recordId]);
    expect(checkGrounding(out, records)).toEqual({ ok: false, unsourced: ['648.00'] });
  });

  it('checks dates against the cited rows', () => {
    const cited = [c.recordId, nov05.recordId];
    expect(checkGrounding(explain('It cost €649.00 on 2026-11-05.', cited), records).ok).toBe(true);
    expect(checkGrounding(explain('It cost €649.00 on 2026-11-06.', cited), records)).toEqual({
      ok: false,
      unsourced: ['2026-11-06'],
    });
  });

  it('ignores the digits inside record ids and words', () => {
    const out = explain('See c-tv55-ph-1023 and the tv55 listing [c-tv55-of-1].', [c.recordId]);
    expect(checkGrounding(out, records)).toEqual({ ok: true });
  });

  it('allows the rule constants it is given, and nothing else', () => {
    const out = explain('Lower than any price of the 30 days before.', [c.recordId]);
    expect(checkGrounding(out, records, { constants: [30] })).toEqual({ ok: true });
    expect(checkGrounding(out, records)).toEqual({ ok: false, unsourced: ['30'] });
  });

  it('allows numbers quoted from a cited record\'s text, like "Only 2 left!"', () => {
    const e = offer('e-tv55');
    expect(e.stockLabel).toContain('2');
    const out = explain(`The listing says "${e.stockLabel ?? ''}".`, [e.recordId]);
    expect(checkGrounding(out, records)).toEqual({ ok: true });
  });

  it('rejects computed numbers: a percentage or a saving no record holds', () => {
    const out = explain('You save €50.00, about 8% off.', [c.recordId]);
    expect(checkGrounding(out, records)).toEqual({ ok: false, unsourced: ['50.00', '8'] });
  });

  it('checks every number in a range', () => {
    const out = explain('Prices went 599-649-700.', [c.recordId]);
    expect(checkGrounding(out, records)).toEqual({ ok: false, unsourced: ['700'] });
  });

  it('checks numeric fields as well as text', () => {
    expect(checkGrounding({ amount: 59900, sources: [c.recordId] }, records)).toEqual({ ok: true });
    expect(checkGrounding({ amount: 1234, sources: [c.recordId] }, records)).toEqual({
      ok: false,
      unsourced: ['1234'],
    });
  });

  it('passes text with no numbers and no citations', () => {
    expect(checkGrounding({ note: 'Paid the cheapest offer that passed.' }, records)).toEqual({
      ok: true,
    });
  });
});
