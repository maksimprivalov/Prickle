import { Hono } from 'hono';
import { z } from 'zod';
import { StoreId, StoreIdSchema } from '@core/offers';
import type { Fixtures } from './fixtures';
import {
  formatStoreMoney,
  storeAProducts,
  storeBCatalogPage,
  storeCListings,
  storeDCatalog,
  storeEDealsHtml,
} from './store-shapes';

// Stores A–E as one Hono app under /stores/<id>/. Deterministic: same fixtures, same answers.
// The traps live in the data, never in branches here: this file only changes the shape.
//
// Every store also serves, in its own money format:
//   GET  /stores/:id/offers/:offerId/price-history
//   POST /stores/:id/checkout   { "offerId": "d-tv55" }
//   GET  /stores/:id/about      (store profile: domain age, return policy, trusted)

export type MockStoresOptions = {
  fixtures: Fixtures;
  /** Fixed delay per store, so the parallel scouts are visible on a timeline. Off by default. */
  latencyMs?: Partial<Record<StoreId, number>>;
};

/** Used by `serve`: different per store, so the five scouts finish at different times. */
export const DEMO_LATENCY_MS: Record<StoreId, number> = { a: 300, b: 450, c: 700, d: 400, e: 1100 };

const CheckoutRequest = z.object({ offerId: z.string().min(1) });

export function createMockStoresApp({ fixtures, latencyMs = {} }: MockStoresOptions): Hono {
  const app = new Hono();
  const offersOf = (storeId: StoreId) => fixtures.offers.filter((o) => o.storeId === storeId);
  const offerOf = (storeId: StoreId, offerId: string) =>
    fixtures.offers.find((o) => o.storeId === storeId && o.offerId === offerId);
  const notFound = { error: 'not found' };

  app.use('/stores/:id/*', async (c, next) => {
    const parsed = StoreIdSchema.safeParse(c.req.param('id'));
    if (!parsed.success) return c.json({ error: 'unknown store' }, 404);
    const delay = latencyMs[parsed.data] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    await next();
  });

  // --- Catalogs: each store its own path and shape ---
  app.get('/stores/a/products', (c) => c.json(storeAProducts(offersOf(StoreId.A))));
  app.get('/stores/b/catalog', (c) => {
    const page = z.coerce.number().int().positive().catch(1).parse(c.req.query('page'));
    return c.json(storeBCatalogPage(offersOf(StoreId.B), page));
  });
  app.get('/stores/c/listings', (c) => c.json(storeCListings(offersOf(StoreId.C))));
  app.get('/stores/d/api/v2/catalog', (c) => c.json(storeDCatalog(offersOf(StoreId.D))));
  app.get('/stores/e/deals', (c) => c.html(storeEDealsHtml(offersOf(StoreId.E))));

  // --- Shared endpoints, in each store's money format ---
  app.get('/stores/:id/offers/:offerId/price-history', (c) => {
    const storeId = StoreIdSchema.parse(c.req.param('id'));
    const offerId = c.req.param('offerId');
    if (!offerOf(storeId, offerId)) return c.json(notFound, 404);
    const rows = fixtures.priceHistory
      .filter((r) => r.offerId === offerId)
      .map((r) => ({
        recordId: r.recordId,
        date: r.date,
        price: formatStoreMoney(storeId, r.price),
      }));
    return c.json({ offerId, rows });
  });

  app.post('/stores/:id/checkout', async (c) => {
    const storeId = StoreIdSchema.parse(c.req.param('id'));
    const body = CheckoutRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'expected { "offerId": string }' }, 400);
    const checkout = fixtures.checkouts.find((x) => x.offerId === body.data.offerId);
    if (!offerOf(storeId, body.data.offerId) || !checkout) return c.json(notFound, 404);
    return c.json({
      recordId: checkout.recordId,
      offerId: checkout.offerId,
      lines: checkout.lines.map((line) => ({
        kind: line.kind,
        label: line.label,
        amount: formatStoreMoney(storeId, line.amount),
      })),
      total: formatStoreMoney(storeId, checkout.total),
    });
  });

  app.get('/stores/:id/about', (c) => {
    const storeId = StoreIdSchema.parse(c.req.param('id'));
    const profile = fixtures.stores.find((s) => s.storeId === storeId);
    return profile ? c.json(profile) : c.json(notFound, 404);
  });

  app.notFound((c) => c.json(notFound, 404));
  return app;
}
