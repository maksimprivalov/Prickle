# Prickle — frontend

One page for the demo: the user sets a **mandate**, then watches Prickle work live — five scouts
running side by side, each offer's verdicts with their sources, the mandate guard's decision, and
the spend report with the devnet transaction link. Design document: [`../prickle-idea.md`](../prickle-idea.md);
everything else is in [`../backend/`](../backend/).

**This UI is optional and first on the cut list after x402 and Kora.** Terminal output from
`pnpm demo` is the fallback. So: smallest thing that shows the judges concurrency, sources and
the guard; no polish that costs an hour.

**Status: built** (mandate form, agent timeline, offer cards, guard + spend panel, all from the
event stream). Panel tests render the recorded runs in `src/test/fixtures/` through the stream
reducer rather than through MSW's `sse()`: jsdom has no `EventSource`, and Node's clashes with
jsdom's `Event`. MSW covers `POST /api/sessions`. Update this file when reality diverges.

## Stack

- React 19 + TypeScript (strict), Vite. Package manager: **pnpm** (root workspace), never npm/yarn
- No router: one page. No server-state library: one POST and one event stream
- Live data: `EventSource` on the backend's SSE endpoint, folded into a view model by a pure
  reducer
- Contracts: event and mandate zod schemas imported from `@prickle/backend/contracts`
  (`backend/src/core/events`), never re-declared here
- Forms: react-hook-form + zod (the mandate form)
- Styling: Tailwind CSS v4, CSS-first (`@theme` in `src/styles/theme.css`)
- Tests: Vitest + Testing Library + MSW (including its SSE support)

## Commands (the planned `package.json` scripts)

| Task | Command |
| --- | --- |
| Dev server (needs `pnpm dev` running in `backend/`) | `pnpm dev` |
| Typecheck / lint / unit tests | `pnpm typecheck` / `pnpm lint` / `pnpm test` |
| Everything | `pnpm check` |
| Production build | `pnpm build` |

The Vite dev server proxies `/api` to the backend session server (`http://localhost:8787`), so the
app always calls relative `/api/...` URLs. Run `/verify` before reporting a task as finished.

## Folder structure

```text
src/
  app/                 main.tsx, app.tsx (the one page), providers
  features/
    mandate/           the mandate form; submits POST /api/sessions
    session/           the SSE stream hook + reduce-events.ts (events -> view model)
    timeline/          agent lanes over time: scouts side by side (the concurrency proof)
    offers/            one card per offer: price, verdicts, reasons, sources
    spend/             guard decision, spend report, explorer links
  components/          shared, domain-agnostic: Money, SourceRef, Disclaimer, StatusBadge
  lib/                 api.ts (fetch wrapper), format-money.ts, explorer-url.ts, constants
  styles/              theme.css (Tailwind entry + @theme tokens)
  test/                setup, MSW handlers, recorded event fixtures
```

- A feature folder holds its components, hooks and helpers flat; add a subfolder only past ~8
  files. Each feature exports through `index.ts`; features import each other only through it.
- `lib/` and `components/` never import from `features/`.
- kebab-case files, one component per file, named exports only.
- Aliases: `@app`, `@features`, `@components`, `@lib`, `@styles`, `@test`. No `../` out of a
  feature.

## Hard rules

- **Every number on screen has a source.** Prices, fees, totals, balances and dates render through
  `<Money>` / `<SourceRef>` with the `recordId` from the event payload, visible on hover/focus and
  in the offer's detail. The UI never computes a new money value (no sums, differences or
  percentages); if a number is needed, the backend emits it with a source. Formatting only.
- **Money is integers.** Values arrive as cents / USDC base units; `lib/format-money.ts` is the
  only place they become strings (`Intl.NumberFormat`, integer division by the unit). No float
  math, no `toFixed` on a price.
- **"Not financial advice" is always visible** while a session is shown, via `<Disclaimer>`.
- **Events are the only state from the server.** The view is `reduceEvents(events)`, a pure
  function; never copy event data into separate `useState` or Context. Unknown event types are
  ignored, not crashed on; every event is parsed with the contract schema before reducing.
- **The guard's decision is the backend's.** The UI shows allow/deny and the reasons it received;
  it never decides or hides one. A deny shows the best option and why it fails.
- **Explorer links point at devnet only** (`https://explorer.solana.com/tx/<sig>?cluster=devnet`,
  built in `lib/explorer-url.ts`); a mock-wallet signature is shown as "mock payment", not linked.
- **No secrets in the frontend.** Nothing in `VITE_*` env or the bundle is private. The LLM key and
  the wallet stay in the backend.
- No `any`; no TypeScript `enum` (`const` object + derived union). No data fetching in
  `useEffect` except opening the `EventSource`, which is synchronizing with an external system.
- Do not add, upgrade or remove a dependency without asking. Do not weaken or skip tests.
- Smallest change that works; this is a two-day build and the UI is optional.

## Detailed rules

Loaded from `.claude/rules/` when matching files are touched:

| File | Scope |
| --- | --- |
| `event-stream.md` | `features/session/**`, `features/mandate/**`, `lib/api.ts` |
| `money-and-sources.md` | every `.tsx`, `lib/format-money.ts` |
| `components.md` | every `.tsx` |
| `styling.md` | `.tsx`, `.css` |
| `accessibility.md` | `.tsx`, `.css` |
| `typescript.md` | all `.ts` / `.tsx` |
| `testing.md` | test files |

## Claude Code setup

- **Skills:** `/verify` (typecheck, lint, test, build), `/add-view <name>` (a new panel fed by
  events), `/pre-pr` (read-only review of the branch against these rules).
- **Hooks:** edits to `.env*` (except `.env.example`), `pnpm-lock.yaml` and `../LICENSE` are
  denied; each edited `.ts`/`.tsx`/`.css` file gets Prettier.
- **Permissions:** pnpm scripts and read-only git are pre-approved.
- **No AI attribution** in commits or pull requests: no `Co-Authored-By` trailer, no "Generated
  with" line. The shared settings turn Claude's attribution off; don't add it by hand.
- Backend work (events, agents, guard) belongs in a session started in `../backend/`, which has
  its own rules and hooks.
