---
paths:
  - "src/runtime/**/*.ts"
  - "src/app/**/*.ts"
---

# The runtime port and the Mozaik adapter

## The port

`src/runtime/port.ts` is our own interface. Everything above it (agents, tools, app) talks to the
port, never to Mozaik:

- start an agent loop (returns a handle; not awaited one by one);
- publish an event; react to an event (situation handler);
- read and write shared session state (mandate, offers, verdicts, budget, wallet status);
- intercept a step before it runs (used by the guard on `payment.requested`);
- every event published also goes to the run log (JSONL, append-only).

Keep it small. If the port grows past what the five agents need, stop.

## `runtime/mozaik/` — the only Mozaik import

- ESLint `no-restricted-imports` blocks `@mozaik-ai/core` everywhere else. Never disable that
  rule; if something outside needs Mozaik, it needs a port method instead.
- **Never guess a Mozaik signature.** Before writing or changing a call, read the type
  definitions in `node_modules/@mozaik-ai/core` (`.d.ts`), then the Mozaik Quickstart or the
  mozaik-examples repo. Quote what you read when it settles a question. The idea's names
  (`defineRuntime`, `createAgent`, `createHuman`, `runLoop`, `RuntimeState`, `FunctionTool`,
  situation handlers, interception, semantic events) are unverified.
- Map: session → runtime; shared state → our `RuntimeState` subclass; user → human participant;
  agent spec → agent; `reactsTo` → situation handler; tool spec → `FunctionTool`; guard →
  interception; our event names → Mozaik semantic events.
- **Use the real features**, because that is what is scored: 5 scout loops and the budget agent
  started concurrently with `runLoop`, verifiers as situation handlers, guard as interception.
  Starting loops with `await` in a `for` loop is a bug.
- Mozaik Cloud pairing must need no code change (`npx @mozaik-ai/cloud-sdk pair`).

## `runtime/plain/` — optional

`Promise.all` + `EventEmitter` behind the same port, for tests and as proof the code is portable.
Build it only if time allows; tests of agents and tools must not need it.

## `src/app/`

- `cli/demo.ts` — judge mode: fixed mandate (or one from argv), one runtime, terminal output,
  writes `runs/<session>.jsonl`, prints the spend report and "not financial advice".
- `cli/eval.ts` — runs every offer, reads the logs, prints the trap and timing tables; exits
  non-zero if the mandate was ever exceeded.
- `server/` — Hono: `POST /api/sessions` (mandate in, `sessionId` out) and
  `GET /api/sessions/:id/events` (SSE, one message per run-log event, replayed from the start
  for late subscribers). The frontend's only API. CORS for `http://localhost:5173` only.
- The app picks the runtime adapter and the wallet from env, validated with zod at start-up.
