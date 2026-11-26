# Prickle: who builds what, and when

Two-person work split and timeline · Mozaik Black Friday AI Hackathon, Thu 26 – Fri 27 November
2026 · based on [`prickle-idea.md`](prickle-idea.md), [`backend/CLAUDE.md`](backend/CLAUDE.md) and
[`frontend/CLAUDE.md`](frontend/CLAUDE.md).

**In one line:** split along the two seams the design already has, the event contracts
(`core/events`) and the runtime port (`runtime/port.ts`). Person 1 (Maksim) builds the engine and
the money: runtime adapter, guard, payments, the code checks and the agents that decide. Person 2
(Tara) builds the world and the story: data, stores, tools, the agents that search and inspect,
the eval, the UI and the submission. Each person owns separate folders, so the two Claude Code
sessions rarely touch the same file.

## 1. The split

| Person 1: Maksim, engine and money | Person 2: Tara, world, agents and story |
| --- | --- |
| Scaffolding: pnpm workspace, tsconfig, ESLint (Mozaik import rule), Prettier, Vitest, all dependencies | `core/events`: zod contracts for the mandate and every event; record shape with `recordId` |
| `core/money`: integer money types, EUR → test USDC | Seeded data generator + fixtures: 5 stores, ~40 offers, 60-day price histories, checkout breakdowns, store details |
| `runtime/port.ts` + `plain/` + `mozaik/` adapter (concurrent loops, shared state, situation handlers, interception) | The 5 traps (`/add-trap`), including the demo story (Store B passes, C fake discount, D hidden fee) |
| `core/guard`: the mandate guard, in interception and inside `pay()` | `mock-stores/`: Hono server, each store answering in a different shape (fix 4, part a) |
| `payments/`: wallet port, mock wallet, devnet wallet, `wallet:setup` | `tools/`: catalog, price history, checkout total, all returning record ids |
| `core/deal`: EU 30-day rule (fix 2) + deal verifier agent | 5 scout agents + prompts |
| `core/grounding`: number-grounding check (fix 1) | Merchant-risk agent (hidden fee, fake scarcity, no refund policy) |
| Reviewer agent, including resolving verifier/risk disagreements (fix 4, part b) | Terminal output of `pnpm demo` (the "expected output" in the README) |
| Budget agent | `pnpm eval`: trap table, honest deals wrongly rejected, "mandate never exceeded" assertion |
| `app/` wiring: `pnpm demo`, session server (POST mandate, SSE stream) | `frontend/` (optional, first to cut) |
| Spend report with transaction signatures | README, `/judge-run` on a clean clone (fix 3), pitch with the two users (fix 6), demo video, submission |
| Mozaik Cloud pairing + concurrency timing table (fix 5) | |

### What changes from the plan in `prickle-idea.md`, and why

- **Merchant-risk agent moves from Maksim to Tara.** It reads checkout breakdowns, refund
  policies and scarcity labels: data and traps Tara creates, so Tara knows exactly what it must
  catch.
- **Maksim takes the unassigned pieces that sit on the critical path:** the Mozaik runtime
  adapter, the grounding check, the reviewer, the budget agent and the session server. The idea
  doc never assigned these, and they all depend on the runtime and money code Maksim already owns.
- **Tara takes the eval and the event contracts.** The eval is "did we catch my traps", so it
  belongs with the data. The contracts come first because both people build against them.

### Rough load (hours of focused work)

| Maksim | h | Tara | h |
| --- | --: | --- | --: |
| Scaffold + money | 2 | Event contracts | 1.5 |
| Runtime port, plain + Mozaik adapter | 3.5 | Data generator, fixtures, 5 traps | 2.5 |
| Payments: mock + devnet attempt | 2.5 | Mock stores (5 shapes) + 3 tools | 3 |
| 30-day rule + deal verifier | 1.5 | 5 scouts + merchant-risk agent | 3 |
| Guard (code + interception) + grounding | 2.5 | Terminal output + eval | 2.5 |
| Reviewer + budget agent + spend report | 2.5 | Frontend (optional) | 2.5 |
| Demo wiring, session server, Cloud + timing table | 2.5 | README, judge run, pitch, video | 3 |
| **Total** | **17** | **Total** | **18** |

Tara's total includes the frontend, which is optional. If it is cut, Tara takes over the
reviewer's prompt or the budget agent from Maksim to stay even. Maksim's total includes the
devnet attempt; if devnet is dropped at 17:00 Thursday, Maksim picks up the session server
earlier and helps with the README's architecture section.

## 2. Timeline, Thursday 26 November

| When | Person 1: Maksim | Person 2: Tara |
| --- | --- | --- |
| 09:00–10:00 | **Together:** Mozaik mini-course. Agree the event list and branch rules (section 4). Confirm which LLM provider Mozaik ships with, so the one env var name for `.env.example` is known. | ← |
| 10:00–11:30 | **Scaffold PR, merged first.** Root pnpm workspace, `backend/` and `frontend/` packages, strict tsconfig, ESLint with `no-restricted-imports` for `@mozaik-ai/core`, Prettier, Vitest, `.env.example`, script stubs from `backend/CLAUDE.md`. Add every dependency now (zod, Hono, Mozaik, Solana, React, Tailwind, MSW) so nobody touches the lockfile later. | **Event contracts draft** (in a branch, rebased onto the scaffold): mandate schema; `offer.found`, `verdict.ready`, `review.done`, `payment.requested`, `guard.decided`, `payment.settled`, `session.ended`; shared `SourceRef { recordId }`. Money fields typed as integer cents / base units. |
| 11:30 | **Sync (15 min):** Maksim reviews the contracts, then they are frozen. From now on, a contract change is a small PR that the other person approves. | ← |
| 11:30–14:00 | `core/money` + tests. Read the Mozaik `.d.ts` and the Quickstart; write the real signatures into `backend/CLAUDE.md` → open items. `runtime/port.ts` and the plain adapter (`Promise.all` + `EventEmitter`), so Tara can run agents before the Mozaik adapter exists. | Seeded data generator (`pnpm gen:data`): 5 stores, ~40 offers, 60-day histories, checkout breakdowns, domain age, refund policy. Plant the 5 traps with `/add-trap`. Make sure the demo story is in the data exactly: B €585 passes, C fake discount, D €49 fee. Commit the fixtures. |
| 14:00–15:00 | Lunch. | Lunch. |
| 15:00–17:00 | Mozaik adapter: runtime per session, shared state, scouts started with `runLoop` (not awaited), situation handlers on `offer.found`. In parallel: wallet port + mock wallet; run `wallet:setup`, get SOL and test USDC from Circle's faucet. | Mock stores (Hono): A clean JSON, B messy product text, C paged catalog, D/E their own shapes. Then the tools with `/add-tool`: catalog per store, price history, checkout total. Each returns records with a `recordId`. |
| **17:00** | **Decision:** does a devnet USDC transfer work? If yes, Maksim finishes it on Friday morning. If no, stay on the mock wallet and drop devnet. | ← |
| 17:00–20:00 | `core/deal` 30-day rule + tests (fix 2), then the deal verifier agent with `/add-agent`. `core/guard` as plain code + tests (amount ≤ mandate, trusted store, verified discount). `app/` wiring for `pnpm demo` and the JSONL run log. | 5 scout agents + prompts with `/add-agent`. Each emits `offer.found`. Run them on the plain adapter first, then on the Mozaik adapter as soon as it lands. Start the terminal output format for `pnpm demo`. |
| **20:00** | **Milestone:** first mandate end to end on the mock wallet: 5 scouts in parallel → deal verifier → guard → mock payment. Pair on whatever breaks. Merge everything to `main`; `main` must run `pnpm demo` from here on. | ← |

## 3. Timeline, Friday 27 November

| When | Person 1: Maksim | Person 2: Tara |
| --- | --- | --- |
| 08:30–10:30 | Guard as Mozaik interception (blocks the payment step) and as the check inside `pay()`. Grounding check `core/grounding` + tests (fix 1). Ask the `design-reviewer` agent to check both. Finish the devnet `pay()` if Thursday's decision was yes. | Merchant-risk agent: hidden fee from the checkout total, fake scarcity, missing refund policy, each verdict citing record ids. Polish the terminal output so it matches the "expected output" block in the README. |
| 10:30–12:00 | Session server: `POST /api/sessions` + SSE stream of the run's events on port 8787. Record one run as event fixtures for the frontend tests. | Eval (`pnpm eval`): every offer through Prickle; traps caught per type, honest deals wrongly rejected, a hard failure if the mandate is ever exceeded. Rebuild the README tables with `/eval`. |
| 12:00–14:00 | Reviewer agent: reacts to the verdicts, drops unsourced claims, resolves verifier/risk disagreements and logs the decision (fix 4b). Budget agent. Spend report ("Spent 585 of 600 USDC" + signatures). | Frontend (session started in `frontend/`): mandate form, scout lanes, offer cards with sources, spend panel. Build against the recorded fixtures with MSW, then point it at the live SSE server. Cut this first if behind. |
| **14:00** | **Feature freeze.** From here, only fixes, docs and demo work. Commit `runs/sample-run.jsonl` from a good run. | ← |
| 14:00–15:00 | Lunch. | Lunch. |
| 15:00–17:00 | Pair with Mozaik Cloud (`npx @mozaik-ai/cloud-sdk pair`), screenshot of the 5 parallel loops. Concurrency timing table from the run log (fix 5). Write the README's architecture and "how agents run concurrently" sections. Fix what the judge run finds. | README: what it does, how to run it, eval table. `/judge-run` on a clean clone (fix 3): `pnpm install && pnpm demo` with one LLM key. Pitch: finance first, two users (the shopper, and the bank or wallet that lets customers hand spending to an AI agent safely: fix 6). |
| 16:30 | **Rehearse together.** | ← |
| 17:00–19:00 | **Demos.** One drives the live run (Maksim), one talks (Tara). | ← |
| 19:00–22:00 | Last fixes from the demo feedback, second clean-clone check, rules checklist from the idea doc. | Demo video, screenshots, submission text (name, description, how the agents run concurrently). |
| **by 22:00** | **Submit.** Two hours of buffer before the midnight CET deadline; resubmitting is allowed. | ← |

## 4. How to run two Claude Code sessions without collisions

- **Both sessions start in `backend/`** (Tara's frontend session starts in `frontend/`), so the
  hooks, rules and skills load.
- **Each person works in their own branch or git worktree;** small PRs into `main`.
- **Folder ownership follows section 1.** Only the owner edits a folder; the other asks via a PR
  comment or a short message.
- **Shared files and who owns them:** `core/events`: Tara · `package.json` / lockfile: Maksim
  (all deps in the scaffold PR) · `app/`: Maksim · `README.md`: Tara, with Maksim writing the
  architecture and concurrency sections.
- **Agents are plain data, so nobody waits for the adapter.** Tara writes scout specs against
  `runtime/port.ts` and runs them on the plain adapter; Maksim swaps in the Mozaik adapter under
  them.
- **Data is ready before the agents.** Maksim builds the 30-day rule and the guard against the
  committed fixtures, even before Tara's tools and stores exist.
- **Skills to use:** `/add-agent`, `/add-tool`, `/add-trap`, `/verify` before every PR, `/eval`,
  `/judge-run`, the `design-reviewer` agent before merging guard, money, payments, runtime or
  grounding changes, `/pr`; `/verify` and `/pre-pr` in the frontend.
- **Fixtures are generated.** A hook blocks hand edits to `data/fixtures/**`: change the
  generator and run `pnpm gen:data`.

## 5. Sync points and fallbacks

| When | Check | If it is not there |
| --- | --- | --- |
| Thu 11:30 | Scaffold merged, contracts frozen | Pair until both are done; nothing else starts without them |
| Thu 17:00 | Devnet USDC transfer works | Mock wallet only; Maksim's devnet time goes to the session server |
| Thu 20:00 | One mandate end to end on the mock wallet | Friday morning starts with this, together; merchant-risk and reviewer prompts shrink |
| Fri 12:00 | Grounding, 30-day rule and eval green | Drop the frontend; Tara joins Maksim on what is missing |
| Fri 14:00 | Feature freeze, sample run committed | Cut in this order: x402, Kora, the UI, the devnet payment |
| Fri 16:30 | Clean-clone judge run passes | Everything else waits until it does |

**Never cut:** the parallel agents, the guard, the sources and the eval. **Must-haves:** fixes 1
(number grounding: Maksim), 2 (30-day rule: Maksim) and 3 (judge mode: Tara runs it, both fix it).

All times are local and approximate. The plan follows the milestones in `prickle-idea.md` →
*Plan*; only the owners of a few pieces changed, as explained in section 1.
