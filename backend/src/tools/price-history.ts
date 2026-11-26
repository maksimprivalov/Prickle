import { z } from 'zod';
import { PriceHistoryRow, StoreIdSchema } from '@core/offers';
import { defineTool } from '@runtime/port';
import { parseStoreMoney } from './parse-store-money';
import { getJson, type StoreClient } from './store-client';
import { ToolFailure, orFailure } from './tool-failure';

const PriceHistoryInput = z.object({ storeId: StoreIdSchema, offerId: z.string().min(1) });

const PriceHistoryOutput = z.union([
  z.object({ ok: z.literal(true), offerId: z.string(), rows: z.array(PriceHistoryRow) }),
  ToolFailure,
]);

// Every store serves the same envelope; only the price inside is in the store's own format.
const StoreAnswer = z.object({
  offerId: z.string(),
  rows: z.array(z.object({ recordId: z.string(), date: z.string(), price: z.unknown() })),
});

export function createPriceHistoryTool(client: StoreClient) {
  return defineTool({
    name: 'price_history',
    description:
      'Daily prices of one offer over the 60 days up to Black Friday, oldest first, in euro ' +
      'cents. Each row has a recordId: cite the rows a claim about past prices rests on.',
    input: PriceHistoryInput,
    output: PriceHistoryOutput,
    run: async (rawInput, ctx) => {
      const { storeId, offerId } = PriceHistoryInput.parse(rawInput);
      const result = await orFailure(async () => {
        const path = `/stores/${storeId}/offers/${encodeURIComponent(offerId)}/price-history`;
        const answer = StoreAnswer.parse(await getJson(client, path));
        const rows = answer.rows.map((row) =>
          PriceHistoryRow.parse({
            recordId: row.recordId,
            offerId: answer.offerId,
            date: row.date,
            price: parseStoreMoney(storeId, row.price),
          }),
        );
        ctx.records.add(rows);
        return { ok: true as const, offerId: answer.offerId, rows };
      });
      return PriceHistoryOutput.parse(result);
    },
  });
}
