import { z } from 'zod';
import { Offer, StoreIdSchema, type StoreId } from '@core/offers';
import { defineTool } from '@runtime/port';
import { readCatalog } from './read-catalog';
import type { StoreClient } from './store-client';
import { ToolFailure, orFailure } from './tool-failure';

const SearchCatalogInput = z.object({
  /** e.g. "tv", "soundbar", "laptop". Omit to list everything. */
  category: z.string().min(1).optional(),
  /** Only offers with exactly this screen size. */
  screenInches: z.int().positive().optional(),
});

const SearchCatalogOutput = z.union([
  z.object({ ok: z.literal(true), storeId: StoreIdSchema, offers: z.array(Offer) }),
  ToolFailure,
]);

/**
 * One catalog tool per store, so scout-c can only ever search store C. Same tool name for all
 * five: each scout sees exactly one `search_catalog`.
 */
export function createSearchCatalogTool(client: StoreClient, storeId: StoreId) {
  return defineTool({
    name: 'search_catalog',
    description:
      `Lists the offers of store ${storeId.toUpperCase()}: title, category, screen size, price, ` +
      'the "was" price and the date the reduction started if a discount is claimed, and the ' +
      'stock label. Prices are in euro cents. Every offer has a recordId: cite it.',
    input: SearchCatalogInput,
    output: SearchCatalogOutput,
    run: async (rawInput, ctx) => {
      const input = SearchCatalogInput.parse(rawInput);
      const result = await orFailure(async () => {
        const offers = (await readCatalog(client, storeId)).filter(
          (o) =>
            (input.category === undefined ||
              o.category.toLowerCase() === input.category.toLowerCase()) &&
            (input.screenInches === undefined || o.screenInches === input.screenInches),
        );
        ctx.records.add(offers);
        return { ok: true as const, storeId, offers };
      });
      return SearchCatalogOutput.parse(result);
    },
  });
}
