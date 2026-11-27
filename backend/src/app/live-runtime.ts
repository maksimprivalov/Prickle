import { z } from 'zod';
import type { PrickleEvent } from '@core/events';
import type { Mandate } from '@core/mandate';
import { createGeminiSafeRunner } from '@runtime/mozaik/gemini-thought-signatures';
import { createMozaikRuntime } from '@runtime/mozaik/mozaik-runtime';
import type { Runtime } from '@runtime/port';
import type { RunLog } from '@runtime/run-log';
import { createGroundingCheck } from './grounding-check';
import type { SessionState } from './run-session';

// How a live session is built, for both `pnpm demo` and the session server: Mozaik, the model
// tiers from env, the Gemini fix and request limit, and the grounding check (fix 1).

export const LiveEnv = z
  .object({
    GEMINI_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // gemini-3.5-flash was overloaded (503) on every run on 26 Nov; the lite model was not.
    MODEL_FAST: z.string().min(1).default('gemini-3.5-flash-lite'),
    MODEL_STRONG: z.string().min(1).default('gemini-3.5-flash-lite'),
    // Gemini's free tier allows 15 requests per minute per model; stay just under it. 0 = no limit.
    GEMINI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(0).default(14),
    // Under the free-tier limit a loop spends most of its time waiting for a request slot (the
    // live run of 27 Nov had calls a minute apart), so loops get six minutes before they fail.
    LOOP_TIMEOUT_SECONDS: z.coerce.number().int().min(10).default(360),
  })
  .refine((env) => env.GEMINI_API_KEY ?? env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY, {
    message: 'No LLM key: put GEMINI_API_KEY=... in backend/.env (see .env.example).',
  });
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

export function createLiveRuntime(
  env: LiveEnv,
  session: { readonly sessionId: string; readonly mandate: Mandate; readonly log: RunLog },
): Runtime<PrickleEvent, SessionState> {
  const { sessionId, mandate, log } = session;
  const usesGemini = [env.MODEL_FAST, env.MODEL_STRONG].some((m) => m.startsWith('gemini'));
  const runtime = createMozaikRuntime<PrickleEvent, SessionState>({
    sessionId,
    state: { mandate, verdicts: [] },
    log,
    models: { fast: env.MODEL_FAST, strong: env.MODEL_STRONG },
    // Fix 1: answers with a number no cited record holds are dropped before anyone sees them.
    checkOutput: createGroundingCheck({
      sessionId,
      mandate,
      clock: () => new Date(),
      publish: (event) => runtime.publish(event),
    }),
    loopTimeoutMs: env.LOOP_TIMEOUT_SECONDS * 1000,
    // Keeps Gemini's thought signatures, which Mozaik 6.0.0 drops (docs/mozaik-findings.md).
    ...(usesGemini
      ? { inference: createGeminiSafeRunner({ requestsPerMinute: env.GEMINI_REQUESTS_PER_MINUTE }) }
      : {}),
  });
  return runtime;
}
