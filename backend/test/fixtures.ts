import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Mandate } from '@core/mandate';
import {
  CheckoutBreakdown,
  Offer,
  PriceHistoryRow,
  StoreProfile,
  type StoreId,
} from '@core/offers';

// The committed synthetic dataset, parsed with the core schemas, for tests. Read-only: the
// fixtures are generated (pnpm gen:data).

const read = <T>(file: string, schema: z.ZodType<T>): T =>
  schema.parse(
    JSON.parse(readFileSync(new URL(`../data/fixtures/${file}`, import.meta.url), 'utf8')),
  );

export const fixtures = {
  mandate: read('demo-mandate.json', Mandate),
  offers: read('offers.json', z.array(Offer)),
  history: read('price-history.json', z.array(PriceHistoryRow)),
  checkouts: read('checkouts.json', z.array(CheckoutBreakdown)),
  stores: read('stores.json', z.array(StoreProfile)),
};

const find = <T>(items: readonly T[], test: (item: T) => boolean, what: string): T => {
  const item = items.find(test);
  if (item === undefined) throw new Error(`fixture not found: ${what}`);
  return item;
};

export const offer = (offerId: string) =>
  find(fixtures.offers, (o) => o.offerId === offerId, offerId);
export const historyOf = (offerId: string) => fixtures.history.filter((r) => r.offerId === offerId);
export const checkoutOf = (offerId: string) =>
  find(fixtures.checkouts, (c) => c.offerId === offerId, `${offerId} checkout`);
export const storeOf = (storeId: StoreId) =>
  find(fixtures.stores, (s) => s.storeId === storeId, `store ${storeId}`);
