import { z } from 'zod';
import {
  GEMINI_FREE_TIER_REQUESTS_PER_MINUTE,
  createGeminiSafeRunner,
} from '@runtime/mozaik/gemini-thought-signatures';
import type { MozaikRuntimeConfig } from '@runtime/mozaik/mozaik-runtime';

// The model settings from .env, in one place for pnpm demo, pnpm eval and the try scripts.
// Judge mode needs only GEMINI_API_KEY; everything else here is optional.
//
// Gemini's free tier counts requests per model and per Google project, so two levers spread
// the load without paying: keys from other Google projects (GEMINI_API_KEY_2, _3, ...), the one
// that scales, and another model for the reviewer (MODEL_REVIEWER), a small one: measured 27
// Nov, gemini-3.5-flash allows only 5 requests a minute and 20 a day.

export const LlmEnv = z
  .object({
    GEMINI_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // gemini-3.5-flash was overloaded (503) on every run on 26 Nov; the lite model was not.
    MODEL_FAST: z.string().min(1).default('gemini-3.5-flash-lite'),
    MODEL_STRONG: z.string().min(1).default('gemini-3.5-flash-lite'),
    // Default: MODEL_STRONG. Set to gemini-3.5-flash to move the reviewer's calls (one per
    // offer) to that model's free quota; its decision is code, so a failed call only loses the
    // agent's wording. Worth it for a demo or two a day, not for a full live eval (20/day cap).
    MODEL_REVIEWER: z.string().min(1).optional(),
    // Unset: each model's free-tier limit minus one. A number: that for every model. 0: no limit.
    GEMINI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(0).optional(),
  })
  .refine((env) => env.GEMINI_API_KEY ?? env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY, {
    message: 'No LLM key: put GEMINI_API_KEY=... in backend/.env (see .env.example).',
  });
export type LlmEnv = z.infer<typeof LlmEnv>;

/** GEMINI_API_KEY, then GEMINI_API_KEY_2, _3, ... in order, without empties or repeats. */
export function geminiKeys(env: Readonly<Record<string, string | undefined>>): string[] {
  const numbered = Object.keys(env)
    .flatMap((name) => {
      const match = /^GEMINI_API_KEY_(\d+)$/.exec(name);
      return match?.[1] === undefined ? [] : [{ name, n: Number(match[1]) }];
    })
    .sort((a, b) => a.n - b.n)
    .map(({ name }) => name);
  const keys = ['GEMINI_API_KEY', ...numbered].flatMap((name) => {
    const value = env[name]?.trim();
    return value ? [value] : [];
  });
  return [...new Set(keys)];
}

/** Requests per minute for one model: just under its free-tier limit, unless the env says. */
export function requestsPerMinute(env: LlmEnv, model: string): number {
  if (env.GEMINI_REQUESTS_PER_MINUTE !== undefined) return env.GEMINI_REQUESTS_PER_MINUTE;
  const free = GEMINI_FREE_TIER_REQUESTS_PER_MINUTE[model];
  // An unknown Gemini model gets the strictest known limit rather than none.
  return Math.max(
    1,
    (free ?? Math.min(...Object.values(GEMINI_FREE_TIER_REQUESTS_PER_MINUTE))) - 1,
  );
}

/** The model part of a Mozaik runtime config, from the parsed env and the raw env (keys). */
export function llmRuntimeOptions(
  env: LlmEnv,
  rawEnv: Readonly<Record<string, string | undefined>>,
): Pick<MozaikRuntimeConfig<unknown>, 'models' | 'agentModels' | 'inference'> & {
  readonly keyCount: number;
  readonly describe: string;
} {
  const models = { fast: env.MODEL_FAST, strong: env.MODEL_STRONG };
  const reviewer = env.MODEL_REVIEWER ?? env.MODEL_STRONG;
  const agentModels = { reviewer };
  const used = [...new Set([env.MODEL_FAST, env.MODEL_STRONG, reviewer])];
  const usesGemini = used.some((m) => m.startsWith('gemini'));
  const keys = geminiKeys(rawEnv);
  return {
    models,
    agentModels,
    // Keeps Gemini's thought signatures, which Mozaik 6.0.0 drops (docs/mozaik-findings.md).
    ...(usesGemini
      ? {
          inference: createGeminiSafeRunner({
            requestsPerMinute: (model) => requestsPerMinute(env, model),
            apiKeys: keys,
          }),
        }
      : {}),
    keyCount: usesGemini ? keys.length : 0,
    describe:
      `models ${env.MODEL_FAST} (scouts) / ${env.MODEL_STRONG} (checkers, budget) / ` +
      `${reviewer} (reviewer)` +
      (usesGemini && keys.length > 1 ? ` · ${keys.length} Gemini keys` : ''),
  };
}
