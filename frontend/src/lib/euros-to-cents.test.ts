import { describe, expect, it } from 'vitest';
import { eurosToCents } from './euros-to-cents';

describe('eurosToCents', () => {
  it('converts typed euros to integer cents without float parsing', () => {
    expect(eurosToCents('600')).toBe(60000);
    expect(eurosToCents('599.99')).toBe(59999);
    expect(eurosToCents('599,5')).toBe(59950);
    expect(eurosToCents(' 0.1 ')).toBe(10);
  });

  it('rejects anything that is not a plain amount', () => {
    for (const input of ['', 'abc', '1.234', '-5', '1e3', '6 00', '600.']) {
      expect(eurosToCents(input), input).toBeUndefined();
    }
  });
});
