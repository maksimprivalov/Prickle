import { z } from 'zod';
import { StoreIdSchema, StoreProfile } from '@core/offers';
import { defineTool } from '@runtime/port';
import { getJson, type StoreClient } from './store-client';
import { ToolFailure, orFailure } from './tool-failure';

const StoreProfileInput = z.object({ storeId: StoreIdSchema });

const StoreProfileOutput = z.union([
  z.object({ ok: z.literal(true), store: StoreProfile }),
  ToolFailure,
]);

export function createStoreProfileTool(client: StoreClient) {
  return defineTool({
    name: 'store_profile',
    description:
      "A store's profile: name, domain age in days, return policy (refund within N days, all " +
      'sales final, or none stated) and whether it is on the trusted list. Cite its recordId.',
    input: StoreProfileInput,
    output: StoreProfileOutput,
    run: async (rawInput, ctx) => {
      const { storeId } = StoreProfileInput.parse(rawInput);
      const result = await orFailure(async () => {
        const store = StoreProfile.parse(await getJson(client, `/stores/${storeId}/about`));
        ctx.records.add([store]);
        return { ok: true as const, store };
      });
      return StoreProfileOutput.parse(result);
    },
  });
}
