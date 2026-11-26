import { z } from 'zod';
import { StoreError } from './store-client';

/** What a tool returns when the store failed: the agent reports it, the loop keeps running. */
export const ToolFailure = z.object({ ok: z.literal(false), reason: z.string().min(1) });
export type ToolFailure = z.infer<typeof ToolFailure>;

/**
 * Runs a tool body and turns a store failure into a ToolFailure. A zod error from a store's
 * answer is a store failure too. Anything else is a bug in our code, so it is rethrown.
 */
export async function orFailure<T>(body: () => Promise<T>): Promise<T | ToolFailure> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof StoreError) return { ok: false, reason: error.message };
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        reason: `store answered in an unexpected shape: ${z.prettifyError(error)}`,
      };
    }
    throw error;
  }
}
