# Findings in Mozaik

Problems we found in `@mozaik-ai/core` while building Prickle, how to reproduce each one, how
we work around it, and a suggested fix. Version: `@mozaik-ai/core` **6.0.0** (published 25 Nov
2026), Node 22, Gemini API, found 26 Nov 2026.

## 1. Gemini agents that call a tool cannot finish: thought signatures are dropped

**Impact.** Every Gemini model Mozaik 6.0.0 supports is a Gemini 3.x model, and Gemini 3.x
requires a *thought signature* to be sent back with each function call. Mozaik drops it, so any
Gemini agent that calls a tool fails on the very next model turn. The tool itself runs; the
agent never gets to answer.

**What you see.** The second request of the loop comes back with:

```text
400 INVALID_ARGUMENT: Function call is missing a thought_signature in functionCall parts.
This is required for tools to work correctly, and missing thought_signature may lead to
degraded model performance.
```

**Cause** (in `node_modules/@mozaik-ai/core/dist/index.mjs`, class
`GeminiGenerateContentMapper`, line 1328):

- `toResponse` (line 1460) turns each `part.functionCall` of Gemini's answer into a
  `FunctionCallItem` with only `callId`, `name` and `args`. The part's `thoughtSignature` is
  discarded, and `FunctionCallItem` has no field to keep it in.
- `mapContextItems` (line 1393) writes the call back into the next request as
  `{ functionCall: { id, name, args } }`, without a `thoughtSignature`.
- Gemini's rule: [Thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures).
- Smaller: when Gemini omits `functionCall.id`, the mapper falls back to `""`, so two calls in
  one loop could share the same `callId`.

**Reproduce** (from `backend/`, with `GEMINI_API_KEY` in `backend/.env`):

```bash
pnpm exec tsx scripts/try-scouts.ts --no-gemini-fix
```

Five scout agents start at once; each calls its store's catalog tool successfully (the run log
in `runs/` shows `tool.called` and `tool.returned ok`), then every one fails with the 400 above:
`0 offers found, 5 of 5 scouts failed`.

**Workaround** (`backend/src/runtime/mozaik/gemini-thought-signatures.ts`, with tests). It uses
only Mozaik's public API: `GeminiGenerateContent.endpointMapper` is public, so we wrap
Mozaik's own mapper rather than replace it.

- On each response: give a function call without an id a unique one, and remember its
  `thoughtSignature` by that id.
- On each request: put the remembered signature back on the matching function call.
- It is passed to the runtime as a custom `InferenceRunner`; every non-Gemini model still goes
  to Mozaik's own endpoint.

The same command without `--no-gemini-fix` then finishes with `5 offers found, 0 of 5 scouts
failed`, on `gemini-3.5-flash-lite`.

**Suggested fix in Mozaik.**

- Add an optional `thoughtSignature` to `FunctionCallItem` (and to `rehydrate`).
- Set it in `toResponse` from `part.thoughtSignature`.
- Write it back next to `functionCall` in `mapContextItems`.
- Generate a `callId` when Gemini sends none.

## 2. A failed model call is not caught inside the loop

Found by Maksim while building the Mozaik adapter (`backend/src/runtime/mozaik/mozaik-runtime.ts`).

**Impact.** `runLoop` is fire-and-forget. When the provider call throws (network error,
overloaded model, invalid key), the loop's promise rejects with nobody listening: an unhandled
rejection, and the agent silently stops. Nothing in the runtime says that the agent failed.

**Workaround.** The adapter wraps the inference runner (`safeInference`). A failed call
becomes an empty model answer, and the error is remembered by context id. The loop then ends
normally and our side reports it as `failed`, with the provider's message. That is how the
reproduction above shows `FAILED: … 400 …` per scout instead of hanging.

**Suggested fix in Mozaik.** Catch inference errors inside the loop and end it with a failure
transition or a semantic event the participant can react to.

## Not Mozaik: provider limits worth knowing

- **Overloaded (503).** `gemini-3.5-flash` answered "This model is currently experiencing high
  demand" on most runs on 26 Nov; `gemini-3.5-flash-lite` did not.
- **Quota (429).** The free Gemini tier answers "You exceeded your current quota" after a few
  back-to-back runs of five concurrent agents.
- **What we do.** Retry both errors up to three times (after 1 s, 2 s and 4 s) in the same
  runner, and use `gemini-3.5-flash-lite` by default.
