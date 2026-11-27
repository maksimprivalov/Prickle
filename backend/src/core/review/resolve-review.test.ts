import { describe, expect, it } from 'vitest';
import type { Reason, Verdict } from '../verdicts';
import { explainReview, resolveReview, reviewReasons } from './resolve-review';

const reason = (code: Reason['code'], source: string): Reason => ({
  code,
  text: `${code}.`,
  sources: [source],
});

const verdict = (
  checker: Verdict['checker'],
  decision: Verdict['decision'],
  code: Reason['code'],
  offerId = 'c-tv55',
): Verdict => ({ offerId, checker, decision, reasons: [reason(code, `${offerId}-of-1`)] });

describe('resolveReview()', () => {
  it('waits until both checkers have a verdict', () => {
    expect(resolveReview('c-tv55', [verdict('deal-verifier', 'reject', 'fake_discount')])).toBe(
      undefined,
    );
  });

  it('passes when both checkers pass, with no disagreement', () => {
    const review = resolveReview('b-tv55', [
      verdict('deal-verifier', 'pass', 'real_discount', 'b-tv55'),
      verdict('merchant-risk', 'pass', 'store_looks_sound', 'b-tv55'),
    ]);
    expect(review).toMatchObject({ decision: 'pass' });
    expect(review?.disagreement).toBeUndefined();
    expect(review?.reasons.map((r) => r.code)).toEqual(['real_discount', 'store_looks_sound']);
  });

  it('rejects Store C when the deal verifier rejects and merchant risk passes, and logs it', () => {
    const review = resolveReview('c-tv55', [
      verdict('deal-verifier', 'reject', 'fake_discount'),
      verdict('merchant-risk', 'pass', 'store_looks_sound'),
    ]);
    expect(review).toEqual({
      offerId: 'c-tv55',
      decision: 'reject',
      reasons: [reason('fake_discount', 'c-tv55-of-1')],
      disagreement: [
        { checker: 'deal-verifier', decision: 'reject' },
        { checker: 'merchant-risk', decision: 'pass' },
      ],
    });
  });

  it('prefers unverifiable over pass, and reject over unverifiable', () => {
    const unsure = resolveReview('x', [
      verdict('deal-verifier', 'unverifiable', 'history_too_short', 'x'),
      verdict('merchant-risk', 'pass', 'store_looks_sound', 'x'),
    ]);
    expect(unsure?.decision).toBe('unverifiable');
    const rejected = resolveReview('x', [
      verdict('deal-verifier', 'unverifiable', 'history_too_short', 'x'),
      verdict('merchant-risk', 'reject', 'hidden_fee', 'x'),
    ]);
    expect(rejected?.decision).toBe('reject');
    expect(rejected?.reasons.map((r) => r.code)).toEqual(['hidden_fee']);
  });

  it("uses each checker's latest verdict and ignores other offers", () => {
    const review = resolveReview('c-tv55', [
      verdict('deal-verifier', 'pass', 'real_discount'),
      verdict('deal-verifier', 'reject', 'fake_discount'),
      verdict('merchant-risk', 'reject', 'hidden_fee', 'd-tv55'),
      verdict('merchant-risk', 'pass', 'store_looks_sound'),
    ]);
    expect(review?.decision).toBe('reject');
    expect(review?.reasons.map((r) => r.code)).toEqual(['fake_discount']);
  });
});

describe('review wording', () => {
  const review = resolveReview('c-tv55', [
    verdict('deal-verifier', 'reject', 'fake_discount'),
    verdict('merchant-risk', 'pass', 'store_looks_sound'),
  ]);
  if (!review) throw new Error('expected a review');

  it('says who decided when the checkers disagree, without numbers', () => {
    expect(explainReview(review)).toBe(
      'The checkers disagree; deal-verifier found fake discount, so the offer is reject.',
    );
  });

  it("puts the reviewer's explanation first, then the deciding reasons", () => {
    const reasons = reviewReasons(review, {
      text: 'The discount fails the 30-day rule; that outweighs a sound store.',
      sources: ['c-tv55-of-1'],
    });
    expect(reasons.map((r) => [r.code, r.text])).toEqual([
      ['fake_discount', 'The discount fails the 30-day rule; that outweighs a sound store.'],
      ['fake_discount', 'fake_discount.'],
    ]);
  });

  it("falls back to the code's wording and the deciding sources", () => {
    const [summary] = reviewReasons(review, undefined);
    expect(summary).toEqual({
      code: 'fake_discount',
      text: explainReview(review),
      sources: ['c-tv55-of-1'],
    });
  });
});
