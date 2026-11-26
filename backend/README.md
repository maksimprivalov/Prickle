# Prickle — backend

**Prickle is a team of AI agents that shops for you on Black Friday, pays from a capped wallet,
and never spends more than you allowed.** A prickle is a group of hedgehogs; ours is a group of
agents that shops, checks every discount and pays, within the limits you set.

> Prickle checks offers against your own rules. It is **not financial advice**. All stores,
> products and prices are synthetic; payments use Solana **devnet** test USDC only.

Built on [`@mozaik-ai/core`](https://www.npmjs.com/package/@mozaik-ai/core) for the Mozaik Black
Friday AI Hackathon (26–27 November 2026, Agentic Payments) by Maksim Privalov and Tara Petričić.
The optional web view is in [`../frontend/`](../frontend/).

## Status

**Not scaffolded yet.** This README describes the planned layout and commands; sections marked
*(from the run log)* are filled by `pnpm eval`, never by hand.

## Run it (judge mode)

Needs Node.js LTS and pnpm, plus one LLM API key. No wallet, no Solana setup.

```bash
pnpm install                 # from the repository root (pnpm workspace)
cp backend/.env.example backend/.env     # paste the one LLM key
pnpm demo                    # one mandate end to end, synthetic data, mock wallet
```

Expected output, abridged (full sample: [`runs/sample-run.jsonl`](runs/sample-run.jsonl)):

```text
Mandate: 55-inch TV, max 600.00 EUR, real discount only, trusted stores only
5 scouts started in parallel ...
Store C  599.00 EUR  REJECTED  fake discount: lowest 30-day price 599.00 (c-tv55-ph-1003)
Store D  599.00 EUR  REJECTED  648.00 at checkout: service fee 49.00 (d-tv55-co-7)
Store B  585.00 EUR  PASSED    was 699.00 for 60 days, 30-day refund policy
Guard: 585.00 <= 600.00, trusted store, verified discount -> PAY
Spent 585 of 600 USDC (mock wallet, tx mock-...)
Not financial advice.
```

### With a real devnet payment (opt-in)

```bash
pnpm --filter backend wallet:setup     # keypair in backend/.wallet/ (gitignored), SOL airdrop
# fund the wallet with test USDC from Circle's devnet faucet (address printed above)
PAYMENTS=devnet pnpm demo
```

The spend report then carries a Solana Explorer link (`?cluster=devnet`) per payment.

## How it works

The user sets a mandate once. Five scouts search Stores A–E in parallel; for each offer the deal
verifier, merchant-risk and budget agents judge it at the same time; the reviewer drops any claim
without a source; the **mandate guard, plain code and not an LLM**, releases the payment only if
it fits. Otherwise Prickle returns the best option and why it falls outside the mandate.

| Part | Mozaik concept | Concurrent? |
| --- | --- | --- |
| Shopping session | runtime | — |
| Mandate, offers, verdicts, budget, wallet | shared state (`RuntimeState` subclass) | — |
| The user | human participant | — |
| 5 scouts, one per store | 5 agents started with `runLoop` | yes, all 5 at once |
| Budget agent | agent started with the scouts | yes |
| Deal verifier, merchant risk | situation handlers on `offer.found` | yes, both on every offer |
| Reviewer | reacts to the other agents' answers | yes |
| Catalog, price history, checkout total, `pay()` | tools | — |
| Mandate guard | interception: blocks the payment step | — |

Checks that are code, not prompts:

- **Number grounding.** Every number an agent outputs must match a value a tool returned in this
  run, with its record id; anything else is rejected before the reviewer sees it.
- **EU 30-day rule.** A discount is real only if the "was" price is no higher than the lowest
  price in the 30 days before the reduction (Omnibus Directive, Art. 6a).
- **Mandate guard.** Amount ≤ mandate, trusted store, verified discount — checked in Mozaik
  interception *and* inside `pay()`.

## How the agents run concurrently

*(from the run log — `pnpm eval` rebuilds this table)*

| | Wall-clock | Sum of individual times |
| --- | --- | --- |
| 5 scouts | — | — |
| Checkers on all offers | — | — |

Mozaik Cloud timeline: pair with `npx @mozaik-ai/cloud-sdk pair` and run `pnpm demo`.

## Eval

*(from the run log — `pnpm eval`)*

| Trap | Planted | Caught | By |
| --- | --- | --- | --- |
| Fake discount | — | — | deal verifier |
| Hidden fee | — | — | merchant risk |
| Fake scarcity | — | — | merchant risk |
| No refund policy | — | — | merchant risk |
| Over budget | — | — | mandate guard |

Honest deals wrongly rejected: —. Mandate exceeded: never (asserted by the eval, which fails
otherwise).

## Layout

```text
src/core/          domain types, events, money, guard, grounding, 30-day rule (no framework)
src/agents/        agent specs        src/prompts/   one .md prompt per agent
src/tools/         zod-typed tools    src/payments/  mock + devnet wallets
src/runtime/       port.ts, mozaik/ (the only Mozaik import), plain/
src/mock-stores/   synthetic Stores A–E, each a different response shape
src/app/           CLI (demo, eval) and the session server (mandate in, SSE out)
scripts/           seeded data generator, wallet setup
data/fixtures/     generated synthetic data (committed, reproducible)
runs/              run logs; sample-run.jsonl is committed
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm demo` | One mandate end to end (judge mode) |
| `pnpm eval` | Every offer through Prickle; trap and timing tables from the log |
| `pnpm dev` | Session server + mock stores, for the frontend |
| `pnpm gen:data` | Regenerate `data/fixtures/` from the seeded generator |
| `pnpm wallet:setup` | Devnet keypair + SOL airdrop |
| `pnpm check` | typecheck + lint + test |

## Configuration

`.env` (gitignored), documented in `.env.example`:

| Variable | Default | |
| --- | --- | --- |
| LLM key (name per Mozaik's provider) | — | the only required value |
| `PAYMENTS` | `mock` | `devnet` for real test transfers |
| `SOLANA_RPC_URL` | devnet public RPC | devnet only; mainnet is refused |
| `PORT` | `8787` | session server |

## Tech

TypeScript on Node.js LTS, pnpm · `@mozaik-ai/core` 4.x · zod · Hono (mock stores, session
server) · `@solana/web3.js` + SPL token · Vitest · Prettier + ESLint · Mozaik Cloud.

## Contributing

Small pull requests into `main`; `main` always runs `pnpm demo`. Commit subjects follow the
existing style, `<type>: <summary>` (`add:`, `fix:`, `change:`, `docs:`, `test:`). Run
`pnpm check` before pushing. Claude Code setup: see [`CLAUDE.md`](CLAUDE.md).

## License

All rights reserved; the hackathon judges may run and evaluate it. See [`../LICENSE`](../LICENSE).
Third-party code keeps its own license (Mozaik is MIT).
