import { beforeAll, describe, expect, it } from 'vitest';
import { StoreId, type Offer } from '@core/offers';
import { createRecordRegistry } from '@runtime/record-registry';
import type { ToolContext } from '@runtime/port';
import { createMockStoresApp } from '../mock-stores/app';
import { loadFixtures, type Fixtures } from '../mock-stores/fixtures';
import { createCheckoutTotalTool } from './checkout-total';
import { createPriceHistoryTool } from './price-history';
import { createSearchCatalogTool } from './search-catalog';
import type { StoreClient } from './store-client';
import { createStoreCatalogTool } from './store-catalog';
import { createStoreProfileTool } from './store-profile';

// The tools against the real mock-store app and the committed fixtures, with no network: the
// client's fetch goes straight into the Hono app. A tool that parses its store right returns
// exactly the fixture records.

let fixtures: Fixtures;
let client: StoreClient;

beforeAll(async () => {
  fixtures = await loadFixtures();
  const app = createMockStoresApp({ fixtures });
  client = { baseUrl: 'http://stores.test', fetch: async (url, init) => app.request(url, init) };
});

const context = (): ToolContext => ({
  sessionId: 's-test',
  agent: 'scout-test',
  records: createRecordRegistry(),
});

/** What Offer.parse keeps: fixtures written without undefined fields compare equal. */
const plain = (offers: readonly Offer[]) => JSON.parse(JSON.stringify(offers)) as unknown;

const STORES = Object.values(StoreId);

describe('search_catalog', () => {
  it.each(STORES)('reads store %s in its own shape into exactly the fixture offers', async (id) => {
    const ctx = context();
    const result = await createSearchCatalogTool(client, id).run({}, ctx);
    if (!result.ok) throw new Error(result.reason);
    expect(plain(result.offers)).toEqual(plain(fixtures.offers.filter((o) => o.storeId === id)));
    expect(ctx.records.all().map((r) => r.recordId)).toEqual(result.offers.map((o) => o.recordId));
  });

  it('filters by category and screen size: each store has exactly one 55-inch TV', async () => {
    for (const id of STORES) {
      const result = await createSearchCatalogTool(client, id).run(
        { category: 'TV', screenInches: 55 },
        context(),
      );
      if (!result.ok) throw new Error(result.reason);
      expect(result.offers.map((o) => o.offerId)).toEqual([`${id}-tv55`]);
    }
  });

  it('gives the same record ids on a second run', async () => {
    const tool = createSearchCatalogTool(client, StoreId.C);
    const first = await tool.run({}, context());
    const second = await tool.run({}, context());
    expect(second).toEqual(first);
  });
});

describe('price_history', () => {
  it("returns Store C's 60 rows: €599 in October, €649 from 1 November", async () => {
    const ctx = context();
    const result = await createPriceHistoryTool(client).run(
      { storeId: StoreId.C, offerId: 'c-tv55' },
      ctx,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows).toEqual(fixtures.priceHistory.filter((r) => r.offerId === 'c-tv55'));
    expect(result.rows.find((r) => r.date === '2026-10-15')?.price).toBe(59_900);
    expect(result.rows.find((r) => r.date === '2026-11-01')?.price).toBe(64_900);
    expect(ctx.records.get('c-tv55-ph-1001')).toBeDefined();
  });

  it.each(STORES)('reads store %s money format in the history', async (id) => {
    const result = await createPriceHistoryTool(client).run(
      { storeId: id, offerId: `${id}-tv55` },
      context(),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows).toEqual(fixtures.priceHistory.filter((r) => r.offerId === `${id}-tv55`));
  });
});

describe('checkout_total', () => {
  it("shows Store D's €49 service fee: €599 becomes €648", async () => {
    const ctx = context();
    const result = await createCheckoutTotalTool(client).run(
      { storeId: StoreId.D, offerId: 'd-tv55' },
      ctx,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.checkout.total).toBe(64_800);
    expect(result.checkout.lines).toContainEqual({
      kind: 'service_fee',
      label: 'Service fee',
      amount: 4_900,
    });
    expect(ctx.records.get('d-tv55-co-1')).toEqual(result.checkout);
  });

  it.each(STORES)('reads store %s checkout into exactly the fixture breakdown', async (id) => {
    const result = await createCheckoutTotalTool(client).run(
      { storeId: id, offerId: `${id}-tv55` },
      context(),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.checkout).toEqual(fixtures.checkouts.find((c) => c.offerId === `${id}-tv55`));
  });
});

describe('store_profile', () => {
  it('returns Store E as untrusted with all sales final', async () => {
    const result = await createStoreProfileTool(client).run({ storeId: StoreId.E }, context());
    if (!result.ok) throw new Error(result.reason);
    expect(result.store).toMatchObject({
      trusted: false,
      returnPolicy: { kind: 'all_sales_final' },
    });
  });
});

describe('when a store fails, the tool reports it instead of throwing', () => {
  const failing = (fetch: StoreClient['fetch']): StoreClient => ({ baseUrl: 'http://x', fetch });

  it('reports an offer the store does not have (404)', async () => {
    const ctx = context();
    const result = await createPriceHistoryTool(client).run(
      { storeId: StoreId.B, offerId: 'c-tv55' },
      ctx,
    );
    expect(failureReason(result)).toContain('404');
    expect(ctx.records.all()).toEqual([]);
  });

  it('reports a store that is down', async () => {
    const down = failing(() => Promise.reject(new Error('ECONNREFUSED')));
    const result = await createSearchCatalogTool(down, StoreId.A).run({}, context());
    expect(failureReason(result)).toContain('unreachable');
  });

  it('reports a store that answers with something that is not JSON', async () => {
    const garbage = failing(() =>
      Promise.resolve(new Response('<html>oops</html>', { status: 200 })),
    );
    const result = await createCheckoutTotalTool(garbage).run(
      { storeId: StoreId.D, offerId: 'd-tv55' },
      context(),
    );
    expect(failureReason(result)).toContain('not JSON');
  });

  it('reports a price in the wrong format instead of guessing it', async () => {
    const floaty = failing(() =>
      Promise.resolve(Response.json({ products: [{ ...storeARow(), priceCents: 585.5 }] })),
    );
    const result = await createSearchCatalogTool(floaty, StoreId.A).run({}, context());
    expect(failureReason(result)).toContain('store A');
  });

  it('reports a store E page with no deals on it', async () => {
    const empty = failing(() =>
      Promise.resolve(new Response('<html><body>Down for maintenance</body></html>')),
    );
    const result = await createSearchCatalogTool(empty, StoreId.E).run({}, context());
    expect(failureReason(result)).toContain('no deals');
  });
});

function storeARow() {
  return {
    recordId: 'a-tv55-of-1',
    id: 'a-tv55',
    title: 'TV',
    category: 'tv',
    screenInches: 55,
    priceCents: 74_900,
    wasPriceCents: null,
    saleStartsOn: null,
    stock: 'In stock',
  };
}

/** The reason of a failed tool result; fails the test if the tool succeeded. */
function failureReason(result: { ok: true } | { ok: false; reason: string }): string {
  if (result.ok) throw new Error('expected the tool to fail');
  return result.reason;
}

describe('store_catalog', () => {
  it.each(STORES)('lists every offer of store %s, whatever store it is asked for', async (id) => {
    const ctx = context();
    const result = await createStoreCatalogTool(client).run({ storeId: id }, ctx);
    if (!result.ok) throw new Error(result.reason);
    expect(plain(result.offers)).toEqual(plain(fixtures.offers.filter((o) => o.storeId === id)));
    expect(ctx.records.all().map((r) => r.recordId)).toEqual(result.offers.map((o) => o.recordId));
  });
});
