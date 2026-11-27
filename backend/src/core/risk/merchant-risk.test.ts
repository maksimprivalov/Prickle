import { describe, expect, it } from 'vitest';
import { checkoutOf, fixtures, offer, storeOf } from '@test/fixtures';
import { cents } from '../money';
import type { StoreId } from '../offers';
import { merchantRisk, SCARCITY_MIN_OFFERS } from './merchant-risk';
import { resolveMerchantRisk } from './resolve-merchant-risk';

const storeOffers = (storeId: StoreId) => fixtures.offers.filter((o) => o.storeId === storeId);

const check = (offerId: string) => {
  const o = offer(offerId);
  return merchantRisk({
    offer: o,
    checkout: checkoutOf(offerId),
    store: storeOf(o.storeId),
    storeOffers: storeOffers(o.storeId),
  });
};

const codesOf = (offerId: string) => {
  const result = check(offerId);
  return result.decision === 'reject' ? result.findings.map((f) => f.code) : [result.code];
};

describe('merchantRisk', () => {
  it('passes Store B, the demo deal, as a sound store', () => {
    expect(check('b-tv55')).toEqual({
      decision: 'pass',
      code: 'store_looks_sound',
      sources: ['b-tv55-of-1', 'b-tv55-co-1', 'b-store-sp-1'],
    });
  });

  it("flags Store D's service fee as a hidden fee, citing the offer and the checkout", () => {
    expect(check('d-tv55')).toEqual({
      decision: 'reject',
      findings: [{ code: 'hidden_fee', sources: ['d-tv55-of-1', 'd-tv55-co-1'] }],
    });
  });

  it('does not call a zero-amount service fee line hidden', () => {
    const checkout = checkoutOf('d-tv55');
    const result = merchantRisk({
      offer: offer('d-tv55'),
      checkout: {
        ...checkout,
        lines: checkout.lines.map((l) =>
          l.kind === 'service_fee' ? { ...l, amount: cents(0) } : l,
        ),
      },
      store: storeOf('d'),
      storeOffers: [],
    });
    expect(result.decision).toBe('pass');
  });

  it("flags Store E: same scarcity label everywhere, no refunds, untrusted", () => {
    expect(codesOf('e-tv55')).toEqual(['fake_scarcity', 'no_refund_policy', 'untrusted_store']);
  });

  it('cites every offer of the store that shows the same low-stock label', () => {
    const result = check('e-tv55');
    if (result.decision !== 'reject') throw new Error('expected reject');
    const scarcity = result.findings.find((f) => f.code === 'fake_scarcity');
    expect(scarcity?.sources).toHaveLength(storeOffers('e').length);
    expect(scarcity?.sources[0]).toBe('e-tv55-of-1');
  });

  it('does not call scarcity fake when the agent saw too few offers to see a pattern', () => {
    const few = storeOffers('e').slice(0, SCARCITY_MIN_OFFERS - 1);
    const result = merchantRisk({
      offer: offer('e-tv55'),
      checkout: checkoutOf('e-tv55'),
      store: storeOf('e'),
      storeOffers: few,
    });
    expect(result.decision === 'reject' && result.findings.map((f) => f.code)).not.toContain(
      'fake_scarcity',
    );
  });

  it('does not call scarcity fake when one product says something else', () => {
    const others = storeOffers('e').map((o, i) =>
      i === 1 ? { ...o, stockLabel: 'In stock' } : o,
    );
    const result = merchantRisk({
      offer: offer('e-tv55'),
      checkout: checkoutOf('e-tv55'),
      store: storeOf('e'),
      storeOffers: others,
    });
    expect(result.decision === 'reject' && result.findings.map((f) => f.code)).not.toContain(
      'fake_scarcity',
    );
  });

  it('flags "none stated" as no refund policy', () => {
    const result = merchantRisk({
      offer: offer('b-tv55'),
      checkout: checkoutOf('b-tv55'),
      store: { ...storeOf('b'), returnPolicy: { kind: 'none_stated' } },
      storeOffers: [],
    });
    expect(result).toEqual({
      decision: 'reject',
      findings: [{ code: 'no_refund_policy', sources: ['b-store-sp-1'] }],
    });
  });

  it('catches every trap the answer key gives merchant risk, citing its proof records', () => {
    const traps = fixtures.traps.filter((t) => t.expectedCatcher === 'merchant-risk');
    expect(traps.length).toBeGreaterThan(0);
    for (const trap of traps) {
      const result = check(trap.offerId);
      if (result.decision !== 'reject') throw new Error(`${trap.offerId} passed`);
      const finding = result.findings.find((f) => f.code === trap.trap);
      expect(finding, `${trap.trap} on ${trap.offerId}`).toBeDefined();
      expect([...(finding?.sources ?? [])].sort()).toEqual([...trap.recordIds].sort());
    }
  });

  it('passes every offer of the honest stores A and B', () => {
    for (const o of [...storeOffers('a'), ...storeOffers('b')]) {
      expect(check(o.offerId).decision, o.offerId).toBe('pass');
    }
  });
});

describe('resolveMerchantRisk', () => {
  const records = new Map<string, unknown>(
    [
      ...fixtures.offers,
      ...fixtures.checkouts,
      ...fixtures.stores,
    ].map((r) => [r.recordId, r]),
  );
  const lookup = (id: string) => records.get(id);
  const eIds = storeOffers('e').map((o) => o.recordId);

  it("builds the verdict from the records, keeping the agent's words where the code agrees", () => {
    const result = resolveMerchantRisk({
      offer: offer('d-tv55'),
      report: {
        checkout: 'd-tv55-co-1',
        store: 'd-store-sp-1',
        storeOffers: [],
        explanations: [{ code: 'hidden_fee', text: 'A service fee appears only at checkout.' }],
      },
      lookup,
    });
    expect(result).toEqual({
      ok: true,
      unconfirmed: [],
      verdict: {
        offerId: 'd-tv55',
        checker: 'merchant-risk',
        decision: 'reject',
        reasons: [
          {
            code: 'hidden_fee',
            text: 'A service fee appears only at checkout.',
            sources: ['d-tv55-of-1', 'd-tv55-co-1'],
          },
        ],
      },
    });
  });

  it('drops an explanation for a risk the code did not find, and reports it', () => {
    const result = resolveMerchantRisk({
      offer: offer('b-tv55'),
      report: {
        checkout: 'b-tv55-co-1',
        store: 'b-store-sp-1',
        storeOffers: [],
        explanations: [{ code: 'hidden_fee', text: 'Looks like a hidden fee.' }],
      },
      lookup,
    });
    expect(result.ok && result.verdict.decision).toBe('pass');
    expect(result.ok && result.unconfirmed).toEqual(['hidden_fee']);
  });

  it('uses a plain fallback text when the agent explained nothing', () => {
    const result = resolveMerchantRisk({
      offer: offer('e-tv55'),
      report: { checkout: 'e-tv55-co-1', store: 'e-store-sp-1', storeOffers: eIds, explanations: [] },
      lookup,
    });
    if (!result.ok) throw new Error(result.detail);
    expect(result.verdict.reasons.map((r) => r.code)).toEqual([
      'fake_scarcity',
      'no_refund_policy',
      'untrusted_store',
    ]);
    expect(result.verdict.reasons.every((r) => r.text.length > 0)).toBe(true);
  });

  it("refuses another offer's checkout", () => {
    const result = resolveMerchantRisk({
      offer: offer('d-tv55'),
      report: { checkout: 'b-tv55-co-1', store: 'd-store-sp-1', storeOffers: [], explanations: [] },
      lookup,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses another store's profile, so a clean store cannot vouch for a bad one", () => {
    const result = resolveMerchantRisk({
      offer: offer('e-tv55'),
      report: { checkout: 'e-tv55-co-1', store: 'b-store-sp-1', storeOffers: [], explanations: [] },
      lookup,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a record id no tool returned', () => {
    const result = resolveMerchantRisk({
      offer: offer('d-tv55'),
      report: { checkout: 'd-tv55-co-9', store: 'd-store-sp-1', storeOffers: [], explanations: [] },
      lookup,
    });
    expect(result.ok).toBe(false);
  });

  it('ignores store offer ids that are not offers', () => {
    const result = resolveMerchantRisk({
      offer: offer('e-tv55'),
      report: {
        checkout: 'e-tv55-co-1',
        store: 'e-store-sp-1',
        storeOffers: ['e-tv55-co-1', 'e-made-up-of-1'],
        explanations: [],
      },
      lookup,
    });
    expect(result.ok && result.verdict.reasons.map((r) => r.code)).not.toContain('fake_scarcity');
  });
});
