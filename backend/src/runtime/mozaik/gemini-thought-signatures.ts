import { randomUUID } from 'node:crypto';
import { GeminiGenerateContent, supportedModels, type InferenceRunner } from '@mozaik-ai/core';
import { createRequestLimiter, type RequestLimiter } from './request-limiter';

// Works around a gap in @mozaik-ai/core 6.0.0: its Gemini mapper drops the `thoughtSignature`
// Gemini 3 puts on each function-call part, and Gemini then refuses the next turn with 400
// "Function call is missing a thought_signature". Without this, no Gemini agent can finish a
// loop that used a tool.
//
// The fix wraps Mozaik's own mapper (GeminiGenerateContent.endpointMapper is public): it
// remembers each call's signature when a response comes in, keyed by the call id, and puts it
// back on that call when the next request goes out. Gemini does not always send call ids, so a
// missing one is filled in first; Mozaik then uses it as the FunctionCallItem's callId.
// Remove this file when Mozaik keeps signatures itself.

type Mapper = GeminiGenerateContent['endpointMapper'];
type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The parts of a Gemini response (first candidate) or of every content in a request. */
function partsOf(message: unknown): Json[] {
  if (!isRecord(message)) return [];
  const contents = Array.isArray(message.candidates)
    ? [isRecord(message.candidates[0]) ? message.candidates[0].content : undefined]
    : Array.isArray(message.contents)
      ? message.contents
      : [];
  return contents.flatMap((content) =>
    isRecord(content) && Array.isArray(content.parts) ? content.parts.filter(isRecord) : [],
  );
}

const callOf = (part: Json): Json | undefined =>
  isRecord(part.functionCall) ? part.functionCall : undefined;

/** `signatures` can be shared, so endpoints for several API keys use one memory. */
export function keepThoughtSignatures(
  inner: Mapper,
  signatures: Map<string, string> = new Map(),
): Mapper {
  return {
    toResponse(response: unknown) {
      for (const part of partsOf(response)) {
        const call = callOf(part);
        if (!call) continue;
        if (typeof call.id !== 'string' || call.id === '') call.id = `call-${randomUUID()}`;
        if (typeof part.thoughtSignature === 'string' && typeof call.id === 'string') {
          signatures.set(call.id, part.thoughtSignature);
        }
      }
      return inner.toResponse(response);
    },
    toRequest(inferenceInput) {
      const request: unknown = inner.toRequest(inferenceInput);
      for (const part of partsOf(request)) {
        const call = callOf(part);
        const signature = typeof call?.id === 'string' ? signatures.get(call.id) : undefined;
        if (signature !== undefined) part.thoughtSignature = signature;
      }
      return request;
    },
  };
}

/** "Overloaded" (503) and "too many requests" (429) pass in seconds; anything else is real. */
const BUSY = /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED/;

/**
 * How long the provider asked us to wait, e.g. Gemini's 429 says "Please retry in 2.3s" and
 * carries "retryDelay":"2s". Undefined when the error says nothing.
 */
export function retryDelayMs(message: string): number | undefined {
  const match =
    /retry in ([\d.]+)s/i.exec(message) ?? /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(message);
  const seconds = match?.[1] === undefined ? NaN : Number(match[1]);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

/**
 * Retries a model call that failed because the provider was busy: after 1 s, 2 s, then 4 s, or
 * after the delay the provider asked for when that is longer (at most a minute).
 */
export async function retryWhenBusy<T>(
  call: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!BUSY.test(message) || attempt >= 3) throw error;
      const asked = retryDelayMs(message);
      await wait(Math.min(Math.max(1000 * 2 ** attempt, (asked ?? 0) + 500), 60_000));
    }
  }
}

/**
 * Free-tier requests per minute per model, read from Gemini's own 429 answers on 27 Nov
 * ("quotaValue"). Quotas are per model and per Google project.
 */
export const GEMINI_FREE_TIER_REQUESTS_PER_MINUTE: Readonly<Record<string, number>> = {
  'gemini-3.5-flash-lite': 15,
  'gemini-3.5-flash': 5,
};

/**
 * Hands out items in turn, but always the same one for the same id: each agent loop (one
 * Mozaik context id) stays on one API key for its whole life, so a thought signature never
 * travels to a key of another Google project, while new loops spread over all keys.
 */
export function createStickyPicker<T>(items: readonly [T, ...T[]]): (id: string) => T {
  const chosen = new Map<string, T>();
  let next = 0;
  return (id) => {
    const known = chosen.get(id);
    if (known !== undefined) return known;
    const item = items[next % items.length] ?? items[0];
    next++;
    chosen.set(id, item);
    return item;
  };
}

/**
 * Mozaik's model dispatch with the Gemini fix: Gemini models go through patched endpoints, one
 * per API key, sharing one signature memory (so use one runner per session); every other model
 * goes to Mozaik's own endpoint unchanged.
 */
export function createGeminiSafeRunner(
  options: {
    /**
     * Gemini requests per minute, per model and per key; 0 or unset means no limit. A function
     * gives each model its own (see GEMINI_FREE_TIER_REQUESTS_PER_MINUTE).
     */
    readonly requestsPerMinute?: number | ((model: string) => number);
    /**
     * Gemini API keys, each from a different Google project to add up quotas (two keys of one
     * project share it). Unset or empty: Mozaik's default, GEMINI_API_KEY from the environment.
     */
    readonly apiKeys?: readonly string[];
  } = {},
): InferenceRunner {
  const perMinute = (model: string) => {
    const limit = options.requestsPerMinute ?? 0;
    return typeof limit === 'number' ? limit : limit(model);
  };
  const signatures = new Map<string, string>();
  const endpoint = (apiKey: string | undefined) => {
    const created = new GeminiGenerateContent(undefined, apiKey === undefined ? {} : { apiKey });
    created.endpointMapper = keepThoughtSignatures(created.endpointMapper, signatures);
    return { endpoint: created, limiters: new Map<string, RequestLimiter>() };
  };
  const [firstKey, ...moreKeys] = options.apiKeys ?? [];
  const keyed =
    firstKey === undefined
      ? ([endpoint(undefined)] as const)
      : ([endpoint(firstKey), ...moreKeys.map(endpoint)] as const);
  const pick = createStickyPicker(keyed);

  const limiterFor = (limiters: Map<string, RequestLimiter>, model: string) => {
    const existing = limiters.get(model);
    if (existing) return existing;
    const created = createRequestLimiter({ perMinute: perMinute(model) });
    limiters.set(model, created);
    return created;
  };
  const nonGeminiEndpoint = (model: string) => {
    const supported = supportedModels.find((m) => m.specification.name === model);
    if (!supported) throw new Error(`Unsupported model: ${model}`);
    return supported.endpoint instanceof GeminiGenerateContent ? undefined : supported.endpoint;
  };
  return {
    // Through a promise, so an unsupported model rejects like a failed call instead of throwing.
    // The limiter is inside the retry, so a retried call waits for a slot like any other.
    run: (input) =>
      retryWhenBusy(async () => {
        const other = nonGeminiEndpoint(input.model);
        if (other) return other.infer(input);
        const { endpoint: gemini, limiters } = pick(input.context.id);
        await limiterFor(limiters, input.model).acquire();
        return gemini.infer(input);
      }),
    async *stream(input) {
      yield* (nonGeminiEndpoint(input.model) ?? pick(input.context.id).endpoint).stream(input);
    },
  };
}
