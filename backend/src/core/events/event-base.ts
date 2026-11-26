import { z } from 'zod';

/** Every event says which session it belongs to, when it happened and who emitted it. */
export const eventBase = {
  sessionId: z.string().min(1),
  /** ISO timestamp, set by the caller: core has no clock. */
  at: z.iso.datetime(),
  /** The emitting agent instance ("scout-c", "deal-verifier") or "app" / "guard". */
  agent: z.string().min(1),
};
