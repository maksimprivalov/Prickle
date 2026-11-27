import { z } from 'zod';
import type { PrickleEvent } from '@core/events';
import type { Mandate } from '@core/mandate';
import { createMozaikRuntime } from '@runtime/mozaik/mozaik-runtime';
import type { Runtime } from '@runtime/port';
import type { RunLog } from '@runtime/run-log';
import { createGroundingCheck } from './grounding-check';
import { NO_LLM_KEY, hasLlmKey, llmEnvFields, llmRuntimeOptions } from './llm-config';
import type { SessionState } from './run-session';

// How a live session is built, for `pnpm demo`, `pnpm eval` and the session server: Mozaik, the
// models, keys and per-model request limits from env (llm-config.ts), the Gemini fix, and the
// grounding check (fix 1).

export const LiveEnv = z
  .object({
    ...llmEnvFields,
    // Under the free-tier limit a loop spends most of its time waiting for a request slot (the
    // live run of 27 Nov had calls a minute apart), so loops get six minutes before they fail.
    LOOP_TIMEOUT_SECONDS: z.coerce.number().int().min(10).default(360),
  })
  .refine(hasLlmKey, { message: NO_LLM_KEY });
export type LiveEnv = z.infer<typeof LiveEnv>;

/** Loads backend/.env when there is one; the key may also come from the environment. */
export function loadLiveEnv(): { ok: true; env: LiveEnv } | { ok: false; message: string } {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: checked below.
  }
  const parsed = LiveEnv.safeParse(process.env);
  return parsed.success
    ? { ok: true, env: parsed.data }
    : { ok: false, message: parsed.error.issues.map((i) => i.message).join('\n') };
}

export function newSessionId(prefix: string, now: Date = new Date()): string {
  return `${prefix}-${now.toISOString().replaceAll(/[:.]/g, '-').toLowerCase()}`;
}

/** One line for the terminal: which models, and how many Gemini keys. Never the keys. */
export function describeLive(env: LiveEnv, rawEnv: NodeJS.ProcessEnv = process.env): string {
  return llmRuntimeOptions(env, rawEnv).describe;
}

export function createLiveRuntime(
  env: LiveEnv,
  session: { readonly sessionId: string; readonly mandate: Mandate; readonly log: RunLog },
  /** Where the extra Gemini keys (GEMINI_API_KEY_2, ...) are read from. */
  rawEnv: NodeJS.ProcessEnv = process.env,
): Runtime<PrickleEvent, SessionState> {
  const { sessionId, mandate, log } = session;
  // One runner per session: it holds the thought-signature memory and the request limiters.
  const llm = llmRuntimeOptions(env, rawEnv);
  const runtime = createMozaikRuntime<PrickleEvent, SessionState>({
    sessionId,
    state: { mandate, verdicts: [] },
    log,
    models: llm.models,
    agentModels: llm.agentModels,
    // Fix 1: answers with a number no cited record holds are dropped before anyone sees them.
    checkOutput: createGroundingCheck({
      sessionId,
      mandate,
      clock: () => new Date(),
      publish: (event) => runtime.publish(event),
    }),
    loopTimeoutMs: env.LOOP_TIMEOUT_SECONDS * 1000,
    // Gemini thought-signature fix, per-model free-tier limits, one or more keys.
    ...(llm.inference ? { inference: llm.inference } : {}),
  });
  return runtime;
}
