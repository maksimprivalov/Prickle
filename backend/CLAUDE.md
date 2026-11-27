# Prickle — backend

## Why

Black Friday shoppers lose money to fake discounts, hidden checkout fees and overspending, and an
AI agent holding a card with no limits makes the last one worse. Prickle takes a **mandate**
("55-inch TV, at most €600, real discount only, trusted stores only"), lets agents search and
check offers in parallel, and lets **plain code**, not an LLM, release a test payment only when
it fits the mandate. Hackathon project: Mozaik Black Friday AI Hackathon, 26–27 November 2026,
category Agentic Payments. Final submission before midnight CET, Friday 27 November.

The design document is [`../prickle-idea.md`](../prickle-idea.md). Read one section with
`/idea <section>`; read *Mozaik design*, *Portability* and *Scoring → The six fixes* before
designing anything.

## What lives here

Everything except the UI: agents, the Mozaik runtime adapter, the mandate guard, tools, the mock
store API, payments, the synthetic dataset and its generator, the eval, the CLI (`pnpm demo`) and
the session server the frontend streams from. The UI is [`../frontend/`](../frontend/) and is
optional: terminal output comes first.

**Status: scaffolded.** Workspace, configs, all dependencies, `core/money`, the runtime port
(`runtime/port.ts`: `ToolSpec`/`defineTool`, `AgentSpec`/`defineAgent`, `Runtime`), the run log
(`runtime/run-log.ts`, which also records `loop.started`/`loop.finished` and tool calls for the
timing table), the plain adapter (`runtime/plain/`) and the Mozaik adapter
(`runtime/mozaik/`, tested with a scripted model, not yet against a live LLM), the wallets and
`wallet:setup` (`payments/`), the 30-day rule (`core/deal`), the mandate guard (`core/guard`),
`pay()` with its guard interceptor (`payments/pay.ts`), the synthetic data (`pnpm gen:data`,
`data/fixtures/`), the mock stores (`mock-stores/`: `startMockStores()`, or
`pnpm exec tsx src/mock-stores/main.ts` to browse them) and the store tools (`tools/`:
`search_catalog` per store, `price_history`, `checkout_total`, `store_profile`) and the five
scouts (`agents/scout.ts`, `agents/start-scouts.ts`; try them live with
`pnpm exec tsx scripts/try-scouts.ts`), the deal verifier and the budget agent (`agents/`),
and `pnpm demo` (`app/run-session.ts`, `app/cli/demo.ts`) exist. `pnpm demo` runs on Mozaik
with the interim plain-code merchant-risk check (`app/interim-merchant-risk.ts`) until Tara's
merchant-risk agent replaces it. Number grounding (fix 1: `core/grounding`, wired in
`app/grounding-check.ts`) runs on the checkers' and the budget agent's answers; the reviewer is
not wired yet.
`eval` and `dev` are stubs that exit 1. When a folder does not exist
yet, create it as described here rather than inventing a different one; when reality diverges,
update this file in the same change. Inside `src/core/`, use relative imports only: the frontend
imports it without our path aliases.

## The shape of the system

```text
backend/
  src/
    core/         domain types, events, money math, mandate guard, grounding check,
                  EU 30-day rule. NO framework imports (zod only)
    agents/       agent specs: name, prompt file, tools, output schema, events it reacts to
    prompts/      one .md prompt per agent
    tools/        plain async functions with zod schemas: store catalog, price history,
                  checkout total, pay()
    runtime/
      port.ts     our interface: start an agent, publish/react to an event, shared state
      mozaik/     the ONLY place that imports @mozaik-ai/core
      plain/      optional: Promise.all + EventEmitter, for tests and as portability proof
    payments/     wallet port, mock wallet, Solana devnet wallet (@solana/web3.js + SPL)
    mock-stores/  Hono server for synthetic Stores A–E, each answering in a different shape
    app/          wires a runtime adapter to the agents: CLI (demo, eval) and the session
                  server (POST mandate, SSE event stream)
  scripts/        seeded data generator, wallet setup
  data/fixtures/  generated synthetic stores, offers, price histories, traps (committed)
  runs/           run logs (JSONL); only sample-run.jsonl is committed
  test/           shared test helpers; unit tests sit next to their code
```

- **One Mozaik runtime per shopping session.** Agents coordinate through shared state and events,
  not a central orchestrator. 5 scouts (one per store) and the budget agent start together with
  `runLoop`, not awaited one by one. The deal verifier and merchant-risk agent are situation
  handlers on `offer.found`. The reviewer reacts to the others' answers.
- **The mandate guard is plain code in `core/guard/`.** It runs twice: as Mozaik interception
  (blocks the payment step before it runs, visible in the demo) and inside `pay()` itself (so it
  holds without Mozaik). Anything outside the mandate goes back to the user with the best option
  and why it fails.
- **Our events, our names:** `offer.found`, `verdict.ready`, `payment.requested` and the rest are
  zod schemas in `core/events/`, mapped to Mozaik semantic events in the adapter. They are also
  the contract the frontend imports (`@prickle/backend/contracts`).
- **Run log:** every event is appended to `runs/<session>.jsonl`. It is the only source for the
  spend report, the eval table and the concurrency timing table. Nothing is typed in by hand.
- **Payments:** `PAYMENTS=mock` (default, judge mode) or `PAYMENTS=devnet` (real devnet USDC
  transfer, transaction signature in the spend report). Only `payments/` knows which one runs.

## Commands (the planned `package.json` scripts)

| Task | Command |
| --- | --- |
| Judge mode: one mandate end to end, synthetic data, mock wallet | `pnpm demo` |
| Same with a real devnet payment | `PAYMENTS=devnet pnpm demo` |
| Eval: every offer through Prickle, trap table from the log | `pnpm eval` |
| Session server + mock stores (for the frontend) | `pnpm dev` |
| Regenerate synthetic data (seeded) | `pnpm gen:data` |
| Devnet wallet: keypair in `.wallet/`, SOL airdrop | `pnpm wallet:setup` |
| Typecheck / lint / unit tests | `pnpm typecheck` / `pnpm lint` / `pnpm test` |
| Everything the gate runs | `pnpm check` (typecheck + lint + test) |

Run `/verify` before reporting a task as finished, and never claim something works without
having run it.

## Hard rules

- **Money is integers.** Euro cents and USDC base units (6 decimals), as branded types from
  `core/money/`. No floats, no `toFixed` in logic, no `parseFloat` on a price. Formatting happens
  only at the edge (CLI, report). Conversion EUR → test USDC is one function with one rate.
- **The guard is not an LLM**, and nothing an LLM produces can widen the mandate. The guard reads
  the mandate from shared state as the user set it, never from agent output.
- **Every number has a source.** Tools return records with a `recordId`; every agent output lists
  the record ids its numbers came from; `core/grounding/` rejects any number (price, fee, date,
  balance) that does not match a value a tool returned in this run — before the reviewer sees it.
- **The 30-day rule is code.** "Fake discount" is decided in `core/deal/` by the EU Omnibus
  Directive Art. 6a test (lowest price in the 30 days before the reduction vs. the "was" price).
  The LLM explains the verdict; it does not compute it.
- **zod at every boundary:** agent outputs, tool inputs and results, event payloads, store API
  responses, env vars.
- **`@mozaik-ai/core` only in `src/runtime/mozaik/`.** ESLint `no-restricted-imports` enforces it.
  The adapter still has to use real Mozaik features (concurrent loops, situation handlers,
  interception): that is what the judges score. Budget about an hour; don't build a framework.
- **Never guess a Mozaik API.** Exact signatures are an open item. Read the `.d.ts` in
  `node_modules/@mozaik-ai/core`, the Mozaik Quickstart or the mozaik-examples repo first.
- **Devnet only.** Never a mainnet RPC URL, never a real wallet, never real money.
- **Secrets stay out of git and out of context:** `.env` (LLM key) and `.wallet/` (devnet
  keypair) are gitignored and not readable by Claude. `.env.example` documents names only.
- **Every output that recommends or pays says it is not financial advice.**
- **Judge mode must keep working.** `pnpm install && pnpm demo` with one LLM key and nothing else.
  A change that needs a new key, service or manual step makes it opt-in, never the default.
- No `any`; `unknown` and narrow. No TypeScript `enum`; `const` objects with a derived union.
- Do not add, upgrade or remove a dependency without asking.
- Do not weaken, skip or delete a test to get a green run — above all a guard or money test.
- Smallest change that works. No speculative abstraction; this is a two-day build.

## Detailed rules

Loaded from `.claude/rules/` when matching files are touched:

| File | Scope |
| --- | --- |
| `core.md` | `src/core/**`: no framework imports, money, guard, grounding, 30-day rule |
| `agents-and-prompts.md` | `src/agents/**`, `src/prompts/**` |
| `tools.md` | `src/tools/**`, `src/mock-stores/**` |
| `mozaik-runtime.md` | `src/runtime/**` |
| `payments.md` | `src/payments/**`, `scripts/wallet*` |
| `synthetic-data.md` | `data/**`, `scripts/gen*`, `src/mock-stores/**` |
| `typescript.md` | all `.ts` |
| `testing.md` | test files |

## Claude Code setup

- **Skills:** `/verify` (the gate), `/add-agent <name>`, `/add-tool <name>`, `/add-trap <name>`,
  `/eval` (run it, rebuild the README tables from the log), `/judge-run` (fresh clone, judge's
  path, as fix 3 asks), `/idea <section>` (one section of the design doc), `/pr` (PR text).
- **`design-reviewer` agent:** read-only check of a diff or plan against the hard rules above and
  the idea's Mozaik design. Use it before touching the guard, money, payments, the runtime
  adapter or the grounding check.
- **Hooks** (`.claude/hooks/`, Git Bash on Windows): edits to `data/fixtures/**` and
  `runs/sample-run.jsonl` are denied (generated: regenerate), `LICENSE` is denied, `.env*` other
  than `.env.example` and `.wallet/**` are denied; Bash commands that reach a Solana mainnet RPC or
  print a keypair are denied. Each edited `.ts` file gets Prettier.
- **Permissions:** pnpm scripts, read-only git and `gh pr view/list/diff` are pre-approved.
- **No AI attribution** in commits or pull requests: no `Co-Authored-By` trailer, no "Generated
  with" line. The shared settings turn Claude's attribution off; don't add it by hand.

## Team and plan

Full split, hour-by-hour timeline and sync points: [`../work-split.md`](../work-split.md).

| | Owns |
| --- | --- |
| Maksim | scaffold + all deps, `core/money`, `runtime/` (port, plain, Mozaik adapter), `core/guard` + interception, `core/grounding`, `core/deal` + deal verifier, `payments/`, reviewer, budget agent, `app/` (demo CLI, session server), spend report, Cloud pairing + timing table |
| Tara | `core/events` contracts, data generator + fixtures + traps, `mock-stores/`, `tools/`, scouts, merchant-risk agent, terminal output, `pnpm eval`, `frontend/`, README, judge run, pitch, demo video, submission |

Thu until 14:00 setup and data · Thu 15–20 scouts + deal verifier in parallel, first mandate end
to end on the mock wallet · **Thu 17:00 decide devnet or mock** · Fri until 14:00 remaining agents,
guard as interception, spend report · Fri 15–17 eval, README, Mozaik Cloud pairing, rehearsal ·
Fri 17–19 demos · submit before Fri 24:00.

**Must-haves: fixes 1 (number grounding), 2 (30-day rule), 3 (judge mode).** Then 4–6. **Cut in
this order if behind:** x402 bonus, Kora, the UI, the devnet payment. Never cut the parallel
agents, the guard, the sources or the eval.

## Open items

- **Mozaik is 6.0.0** (published 25 Nov 2026), not the 4.x in the idea. The adapter
  (`runtime/mozaik/mozaik-runtime.ts`) is built and tested against its `dist/index.d.ts`. What it
  relies on, read from the source:
  - `defineRuntime()` keeps its runtime in a closure, so each call is a separate runtime: one per
    session works. (`initializeRuntime` throws only when called twice on the *same* one.)
  - `runLoop` returns `void`. The adapter settles each loop at the `model_message` transition
    through its own `InterceptionHandler`, which also gates `function_call` (the guard).
  - The loop uses `inferenceInput.context` and `inferenceInput.tools`, not the agent's memory, so
    each loop gets a fresh context (developer message + user message) and per-loop tools.
  - Mozaik does not catch a failed model call (the loop promise rejects unhandled). The adapter
    wraps the inference runner so a failure ends the loop as `failed` instead.
  - Model names per tier come from config (`models: { fast, strong }`), chosen from Mozaik's
    `supportedModels` (e.g. `gpt-5.4-mini`, `gpt-5.5`, `claude-sonnet-5-5`).
- **LLM key:** Mozaik picks the provider from the model name; `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` all work. **Decided: Gemini** (free key for judges);
  `.env.example` uses `GEMINI_API_KEY`. The `fast`/`strong` model tiers map to Gemini models.
  - **Blocker (found 26 Nov, live scout run):** Mozaik 6.0.0's Gemini endpoint drops
    `thoughtSignature` from `functionCall` parts (`toResponse` / the `functionCall` part in
    `dist/index.mjs`), and Gemini 3.x answers 400 "Function call is missing a thought_signature"
    on the turn after any tool call. So no Gemini agent with a tool can finish on Mozaik 6.0.0.
    **Workaround:** `runtime/mozaik/gemini-thought-signatures.ts` wraps Mozaik's own Gemini
    mapper to keep the signatures, and retries 503/429 (Gemini is often overloaded) up to 3
    times. Pass `inference: createGeminiSafeRunner()` to `createMozaikRuntime` (one per
    session); `scripts/try-scouts.ts` does, and 5/5 scouts finished live on
    `gemini-3.5-flash-lite`. Still to decide: make it the adapter's default. Drop it when Mozaik
    keeps signatures itself. Written up for the judges in
    [`../docs/mozaik-findings.md`](../docs/mozaik-findings.md); keep it current.
  - **Risk for judge mode: the free Gemini quota.** After a few back-to-back runs of five
    concurrent agents the free tier answers 429 "exceeded your current quota". A full `pnpm demo`
    (5 scouts + 2 checkers per offer + reviewer) makes more calls than the scout run. Measure a
    full run's call count before the demo.
- **Mozaik Cloud:** `@mozaik-ai/cloud-sdk` 0.1.5 (a dependency of core) declares peer core
  `^4 || ^5`. Check that pairing works with core 6 early; if not, pin core to 5.0.1.
- **Devnet (checked 26 Nov):** `pnpm wallet:setup` works: genesis hash checked, Circle's devnet
  USDC mint `4zMMC9…DncDU` exists with 6 decimals. Two blockers for the Thu 17:00 decision:
  - the RPC airdrop is closed on devnet (410), so test SOL comes from https://faucet.solana.com
    by hand;
  - Circle's faucet gives far less than the demo's 585 USDC. `pnpm wallet:setup --own-mint`
    creates our own 6-decimal devnet test token and mints the cap (`--fund 600`) instead.
- Store devnet addresses live in `.wallet/stores.json` (generated by setup, public keys only),
  not in the fixtures, so the data stays the same whichever wallet runs.
