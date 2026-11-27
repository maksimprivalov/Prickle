import { describe, expect, it } from 'vitest';
import { Offer } from '../offers/offer';
import { DropReason, resolveMatches } from './resolve-matches';

const offer = (recordId: string, storeId: 'b' | 'c', screenInches: number, category = 'tv') =>
  Offer.parse({
    recordId,
    offerId: recordId.replace(/-of-1$/, ''),
    storeId,
    title: `Test ${screenInches}" TV`,
    category,
    screenInches,
    price: 58_500,
  });

const records = new Map<string, unknown>([
  ['b-tv55-of-1', offer('b-tv55-of-1', 'b', 55)],
  ['b-tv65-of-1', offer('b-tv65-of-1', 'b', 65)],
  ['c-tv55-of-1', offer('c-tv55-of-1', 'c', 55)],
  ['b-tv55-co-1', { recordId: 'b-tv55-co-1', offerId: 'b-tv55', lines: [], total: 58_500 }],
]);

const resolve = (recordIds: string[]) =>
  resolveMatches({
    recordIds,
    lookup: (id) => records.get(id),
    storeId: 'b',
    mandate: { category: 'tv', screenInches: 55 },
  });

describe('resolveMatches', () => {
  it('publishes the offer exactly as the tool returned it', () => {
    const { offers, dropped } = resolve(['b-tv55-of-1']);
    expect(offers).toEqual([records.get('b-tv55-of-1')]);
    expect(dropped).toEqual([]);
  });

  it('drops a record id no tool returned in this run (an invented offer)', () => {
    expect(resolve(['b-tv55-of-9']).dropped).toEqual([
      { recordId: 'b-tv55-of-9', reason: DropReason.NotReturned },
    ]);
  });

  it('drops an offer from another store', () => {
    expect(resolve(['c-tv55-of-1']).dropped).toEqual([
      { recordId: 'c-tv55-of-1', reason: DropReason.OtherStore },
    ]);
  });

  it('drops an offer that is not the mandate product (wrong size)', () => {
    expect(resolve(['b-tv65-of-1']).dropped).toEqual([
      { recordId: 'b-tv65-of-1', reason: DropReason.OtherProduct },
    ]);
  });

  it('drops a record that is not an offer', () => {
    expect(resolve(['b-tv55-co-1']).dropped).toEqual([
      { recordId: 'b-tv55-co-1', reason: DropReason.NotAnOffer },
    ]);
  });

  it('publishes a record named twice once', () => {
    expect(resolve(['b-tv55-of-1', 'b-tv55-of-1']).offers).toHaveLength(1);
  });
});
