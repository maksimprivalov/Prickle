import type { Offer } from '@core/offers';
import { MerchantRiskReport } from '@core/risk';
import { ModelTier, defineAgent } from '@runtime/port';
import {
  createCheckoutTotalTool,
  createStoreCatalogTool,
  createStoreProfileTool,
  type StoreClient,
} from '@tools/index';

// One spec, one loop per offer.found (a situation handler, see react-merchant-risk.ts). It
// gathers the checkout, the store profile and, for a stock warning, the store's catalog; code
// in core/risk decides.

export function createMerchantRisk(client: StoreClient) {
  return defineAgent({
    name: 'merchant-risk',
    prompt: 'merchant-risk.md',
    model: ModelTier.Strong,
    tools: [
      createCheckoutTotalTool(client),
      createStoreProfileTool(client),
      createStoreCatalogTool(client),
    ],
    output: MerchantRiskReport,
  });
}

/** The message a merchant-risk loop starts with: the offer exactly as the store tool returned it. */
export function merchantRiskMessage(offer: Offer): string {
  return [`Offer: ${JSON.stringify(offer)}`, 'Check the store behind this offer.'].join('\n');
}
