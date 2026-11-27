import type { Mandate } from '@core/mandate';
import type { StoreId } from '@core/offers';
import { ScoutReport } from '@core/scouts';
import { ModelTier, defineAgent } from '@runtime/port';
import { createSearchCatalogTool, type StoreClient } from '@tools/index';

// One spec, five instances: scout-a … scout-e. Each has its own store's catalog tool and
// nothing else, so it cannot search another store, and each deals with its own store's shape.

export function createScout(storeId: StoreId, client: StoreClient) {
  return defineAgent({
    name: `scout-${storeId}`,
    prompt: 'scout.md',
    model: ModelTier.Fast,
    tools: [createSearchCatalogTool(client, storeId)],
    output: ScoutReport,
    // One search, one more if it found nothing. In live runs scout E kept searching after it
    // had found the TV, until the loop timed out; the third call is the last one it gets.
    maxToolCalls: 3,
  });
}

/** The message a scout's loop starts with: the mandate as the user set it, and its store. */
export function scoutMessage(mandate: Mandate, storeId: StoreId): string {
  const product = {
    description: mandate.description,
    category: mandate.category,
    ...(mandate.screenInches === undefined ? {} : { screenInches: mandate.screenInches }),
  };
  return [
    `Your store: ${storeId.toUpperCase()}.`,
    `Mandate: ${JSON.stringify(product)}`,
    'Find the offers in your store that are this product.',
  ].join('\n');
}
