import { z } from 'zod';
import { Offer, StoreIdSchema } from '@core/offers';
import { defineTool } from '@runtime/port';
import { readCatalog } from './read-catalog';
import type { StoreClient } from './store-client';
import { ToolFailure, orFailure } from './tool-failure';

const StoreCatalogInput = z.object({ storeId: StoreIdSchema });

const StoreCatalogOutput = z.union([
  z.object({ ok: z.literal(true), storeId: StoreIdSchema, offers: z.array(Offer) }),
  ToolFailure,
]);

/**
 * Every offer of one store, unfiltered. For the checkers, which react to offers from any
 * store: merchant risk needs the whole catalog to see a pattern such as the same "only 2
 * left!" on every product. Scouts keep their own one-store search_catalog.
 */
export function createStoreCatalogTool(client: StoreClient) {
  return defineTool({
    name: 'store_catalog',
    description:
      'Lists every offer of one store with its stock label, price and recordId. Use it to see ' +
      'whether a stock warning is on one product or on all of them. Cite the recordIds.',
    input: StoreCatalogInput,
    output: StoreCatalogOutput,
    run: async (rawInput, ctx) => {
      const { storeId } = StoreCatalogInput.parse(rawInput);
      const result = await orFailure(async () => {
        const offers = await readCatalog(client, storeId);
        ctx.records.add(offers);
        return { ok: true as const, storeId, offers };
      });
      return StoreCatalogOutput.parse(result);
    },
  });
}
