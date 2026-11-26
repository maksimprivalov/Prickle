# Prickle — frontend

The live view of a Prickle shopping session: set a mandate, watch five scouts search in parallel,
see every offer's verdicts with their sources, the mandate guard's decision, and the spend report
with its devnet transaction link.

> Prickle checks offers against your own rules. It is **not financial advice**. All stores and
> prices are synthetic; payments use Solana **devnet** test USDC only.

Everything else — agents, guard, payments, data — is in [`../backend/`](../backend/); the design
is [`../prickle-idea.md`](../prickle-idea.md). This UI is optional: `pnpm demo` in the backend
shows the same run in the terminal.

## Status

**Not scaffolded yet.** This README describes the planned app.

## Run it

```bash
pnpm install                       # from the repository root (pnpm workspace)
pnpm --filter backend dev          # session server + mock stores on :8787
pnpm --filter frontend dev         # http://localhost:5173
```

Open the page, keep the default mandate (*55-inch TV, at most €600, real discount only, trusted
stores only*) or change it, and press **Start shopping**.

## What you see

| Panel | Shows | Built from |
| --- | --- | --- |
| Mandate | what you allowed: product, max price, real discount, trusted stores | your form |
| Agents timeline | one lane per agent; the 5 scouts run side by side | `scout.started` / `scout.finished` and agent events |
| Offers | each offer with price, checkout total, verdicts, reasons and the record each number came from | `offer.found`, `verdict.ready` |
| Decision | the guard's allow or deny, and why | `guard.decided` |
| Spend report | "Spent 585 of 600 USDC" and the transaction link | `payment.settled` |

Every number on the page shows its source record on hover or focus. The page computes no numbers
of its own.

## How it talks to the backend

| Call | Purpose |
| --- | --- |
| `POST /api/sessions` | send the mandate, get a `sessionId` |
| `GET /api/sessions/:id/events` | Server-Sent Events: every run-log event, replayed from the start |

Event and mandate schemas come from `@prickle/backend/contracts`, so both sides share one
definition. In development Vite proxies `/api` to `http://localhost:8787`.

## Layout

```text
src/app/          the page and providers
src/features/     mandate, session (SSE + reducer), timeline, offers, spend
src/components/   Money, SourceRef, Disclaimer, StatusBadge
src/lib/          api, money formatting, explorer links
src/styles/       Tailwind v4 theme
src/test/         MSW handlers and recorded event fixtures
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server with HMR |
| `pnpm build` | Production build to `dist/` |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | the checks |
| `pnpm check` | all three |

## Tech

React 19, TypeScript, Vite, Tailwind CSS v4, react-hook-form + zod, Vitest + Testing Library +
MSW.

## Contributing

Small pull requests into `main`, commit subjects `<type>: <summary>`. Run `pnpm check` first.
Claude Code setup: [`CLAUDE.md`](CLAUDE.md).

## License

All rights reserved; the hackathon judges may run and evaluate it. See [`../LICENSE`](../LICENSE).
