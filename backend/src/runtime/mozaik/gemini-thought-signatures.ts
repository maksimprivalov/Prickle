import { randomUUID } from 'node:crypto';
import { GeminiGenerateContent, supportedModels, type InferenceRunner } from '@mozaik-ai/core';

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

export function keepThoughtSignatures(inner: Mapper): Mapper {
  const signatures = new Map<string, string>();
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

/** Retries a model call that failed because the provider was busy: after 1 s, 2 s, then 4 s. */
export async function retryWhenBusy<T>(
  call: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const busy = BUSY.test(error instanceof Error ? error.message : String(error));
      if (!busy || attempt >= 3) throw error;
      await wait(1000 * 2 ** attempt);
    }
  }
}

/**
 * Mozaik's model dispatch with the Gemini fix: Gemini models go through one patched endpoint
 * (one signature memory per runner, so use one runner per session); every other model goes to
 * Mozaik's own endpoint unchanged.
 */
export function createGeminiSafeRunner(): InferenceRunner {
  const gemini = new GeminiGenerateContent();
  gemini.endpointMapper = keepThoughtSignatures(gemini.endpointMapper);
  const endpointFor = (model: string) => {
    const supported = supportedModels.find((m) => m.specification.name === model);
    if (!supported) throw new Error(`Unsupported model: ${model}`);
    return supported.endpoint instanceof GeminiGenerateContent ? gemini : supported.endpoint;
  };
  return {
    // Through a promise, so an unsupported model rejects like a failed call instead of throwing.
    run: (input) =>
      retryWhenBusy(() => Promise.resolve().then(() => endpointFor(input.model).infer(input))),
    async *stream(input) {
      yield* endpointFor(input.model).stream(input);
    },
  };
}
