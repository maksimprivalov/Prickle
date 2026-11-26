import { z } from 'zod';
import { CheckoutBreakdown, CheckoutLineKind, StoreIdSchema } from '@core/offers';
import { defineTool } from '@runtime/port';
import { parseStoreMoney } from './parse-store-money';
import { postJson, type StoreClient } from './store-client';
import { ToolFailure, orFailure } from './tool-failure';

const CheckoutTotalInput = z.object({ storeId: StoreIdSchema, offerId: z.string().min(1) });

const CheckoutTotalOutput = z.union([
  z.object({ ok: z.literal(true), checkout: CheckoutBreakdown }),
  ToolFailure,
]);

const StoreAnswer = z.object({
  recordId: z.string(),
  offerId: z.string(),
  lines: z.array(
    z.object({ kind: z.enum(CheckoutLineKind), label: z.string(), amount: z.unknown() }),
  ),
  total: z.unknown(),
});

export function createCheckoutTotalTool(client: StoreClient) {
  return defineTool({
    name: 'checkout_total',
    description:
      'Starts a checkout for one offer (nothing is bought) and returns what the store would ' +
      'charge: every line (item, shipping, service fee, tax) and the total, in euro cents. The ' +
      'total is what the user would pay. Cite its recordId.',
    input: CheckoutTotalInput,
    output: CheckoutTotalOutput,
    run: async (rawInput, ctx) => {
      const { storeId, offerId } = CheckoutTotalInput.parse(rawInput);
      const result = await orFailure(async () => {
        const answer = StoreAnswer.parse(
          await postJson(client, `/stores/${storeId}/checkout`, { offerId }),
        );
        // The store states the total; we do not sum it. A total that disagrees with its lines
        // is still what the store would charge, and the guard pays against it.
        const checkout = CheckoutBreakdown.parse({
          recordId: answer.recordId,
          offerId: answer.offerId,
          lines: answer.lines.map((line) => ({
            kind: line.kind,
            label: line.label,
            amount: parseStoreMoney(storeId, line.amount),
          })),
          total: parseStoreMoney(storeId, answer.total),
        });
        ctx.records.add([checkout]);
        return { ok: true as const, checkout };
      });
      return CheckoutTotalOutput.parse(result);
    },
  });
}
