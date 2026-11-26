# Claude Code setup for Prickle

For Maksim, from Tara. This is what the Claude Code setup in this repo contains, why, and what we
still need to agree on. Nothing is scaffolded yet: the setup describes the planned layout and
scripts, so Claude builds what `prickle-idea.md` says instead of inventing something else.

## How to use it

- **Start Claude Code inside `backend/` or `frontend/`, not the repo root.** Settings, hooks and
  permissions only load from the folder a session starts in.
- Backend work (agents, guard, payments, data, events): start in `backend/`.
- UI work: start in `frontend/`.
- Each folder has a `CLAUDE.md` (what Claude reads first), a `README.md` (for people and judges)
  and a `.claude/` folder (settings, hooks, rules, skills).
- The root `CLAUDE.md` is a short pointer to both, plus the rules that hold everywhere.

## Where it came from

I adapted it from two Claude Code setups from an earlier client project: a .NET backend and a
React frontend. I kept how they work and rewrote what they say for Prickle:

| Kept | Rewritten for Prickle |
| --- | --- |
| Hooks that block edits to protected files | Generated data, the sample run log, `LICENSE`, `.env`, wallet keys, the lockfile |
| A hook that formats each edited file | Prettier instead of `dotnet format` |
| `/verify`, the checks to run before committing | pnpm typecheck, lint, Vitest, and a `pnpm demo` smoke run |
| A read-only `design-reviewer` agent | Checks our hard rules: guard, money, devnet, number sources, Mozaik boundary |
| Rules that load only for matching folders | One rule file per part of our code |
| "Read the source, never guess the API" (was about their design system) | Now about Mozaik, whose exact signatures are still an open item |
| Pull-request skills | GitHub and `gh` instead of GitLab |

Dropped because they don't fit a 2-day TypeScript build: database migration, ADR and SDD skills,
OpenSpec (needs its own CLI), the client's design system, translations, login, atomic design.

## Backend (`backend/`)

**`CLAUDE.md`:**
- why Prickle exists
- the planned folder layout (from the idea's *Portability* section, plus `mock-stores/` and
  `payments/`)
- the planned `pnpm` scripts
- hard rules, team split, timeline, cut order, open items

**Hard rules Claude follows:**
- Money is whole numbers only: euro cents and USDC base units.
- The mandate guard is plain code that blocks on any error, and runs both as Mozaik interception
  and inside `pay()`.
- Every number has a `recordId`, checked by code before the reviewer sees it (fix 1).
- The EU 30-day rule is code, not the LLM (fix 2).
- `pnpm install && pnpm demo` with one LLM key must always work (fix 3).
- `@mozaik-ai/core` only in `src/runtime/mozaik/`.
- Devnet only.
- "Not financial advice" on every recommendation or payment.

**Rules (`.claude/rules/`), loaded when Claude touches matching files:**

| File | Covers |
| --- | --- |
| `core.md` | `src/core/`: no framework imports, money, guard, number sources, 30-day rule, events |
| `agents-and-prompts.md` | agents as plain data, real concurrency (5 separate scouts), prompt structure |
| `tools.md` | zod tools returning records with `recordId`; each mock store answers in a different shape (fix 4) |
| `mozaik-runtime.md` | the port, the Mozaik adapter, the CLI and the SSE server |
| `payments.md` | `pay()` steps, mock vs devnet wallet, devnet-only safety |
| `synthetic-data.md` | seeded generator, the five traps, `traps.json` as the eval's answer key |
| `typescript.md`, `testing.md` | conventions; the guard test cases that must exist |

**Skills (type them as commands):**

| Skill | Does |
| --- | --- |
| `/verify` | the checks before committing, including a `pnpm demo` smoke run |
| `/add-agent <name>` | an agent end to end: schema, prompt, spec, adapter, tests |
| `/add-tool <name>` | a tool with record ids and its mock-store endpoint |
| `/add-trap <name>` | a trap through the generator, registered in `traps.json`, proven caught |
| `/eval` | runs the eval and rebuilds the README tables from the run log, never by hand (fixes 1 and 5) |
| `/judge-run` | fresh clone, follows the README exactly like a judge (fix 3) |
| `/idea <section>` | prints one section of `prickle-idea.md` |
| `/pr` | drafts a pull request description with a safety checklist |

**Hooks:**
- **Blocked edits:** `data/fixtures/`, `runs/sample-run.jsonl`, `LICENSE`, `.env`, `.wallet/` and
  keypair files, `pnpm-lock.yaml`.
- **Blocked commands:** any Bash command that names Solana mainnet, and any that prints `.env` or
  a keypair.
- **Formatting:** Prettier runs on each edited file once it is installed.

**Permissions:**
- pre-approved: pnpm scripts, read-only git, and `gh pr view/list/diff`
- Claude is not allowed to read `.env` or the wallet folder

## Frontend (`frontend/`)

Much lighter, because the UI is optional and first on the cut list after x402 and Kora.

**What the page does:** one page, with no router and no component library. The user sets a
mandate, then watches the run live over SSE:
- the 5 scouts side by side (the concurrency proof)
- offers with their verdicts and sources
- the guard's decision
- the spend report with the devnet transaction link

**Event types:** imported from `@prickle/backend/contracts`, never copied, so the two sides
can't drift.

**Rules:**
- `event-stream.md`
- `money-and-sources.md`: every number shows its source, the UI never does money maths, the
  disclaimer is always visible, explorer links go to devnet only
- `components.md`, `styling.md` (Tailwind v4), `accessibility.md` (essentials),
  `typescript.md`, `testing.md`

**Skills:** `/verify`, `/add-view <name>`, `/pre-pr` (read-only review of the branch).

**Hooks:**
- **Blocked edits:** `.env` files, the lockfile and `LICENSE`.
- **Asks first:** an edit to `backend/` from a frontend session.
- **Formatting:** Prettier runs on each edited file.

## Also

- **Claude attribution is off** in both folders: no `Co-Authored-By` line in commits, no
  "Generated with Claude Code" line in pull requests.
- All hook scripts were tested with Windows paths, and both settings files are valid JSON. The
  skills and rules have not been tried in a real session yet.

## Decisions to confirm together

1. **Workspace.** The repo root becomes a pnpm workspace over `backend/` and `frontend/`, so
   `pnpm install && pnpm demo` works from the root.
2. **Layout.** I added `src/mock-stores/` and `src/payments/` to the idea's folder layout.
3. **Ports.** The backend server runs on 8787, and Vite forwards `/api` to it.
4. **Exchange rate.** 1 EUR = 1 test USDC, stated in the spend report.
5. **Prettier.** It is a new dev dependency.
6. **Event names.** I added `guard.decided`, `payment.settled`, `payment.failed`,
   `grounding.rejected`, `scout.started`, `scout.finished` and `session.ended` to the three in
   the idea.
7. **Commits.** Commit subjects follow our first commit's style, `<type>: <summary>`. Small pull
   requests go into `main`.

## Still open (from the idea)

- Exact Mozaik signatures: check them in the Quickstart and mozaik-examples before writing the
  adapter.
- Which LLM provider Mozaik bundles, which decides the one variable name in `.env.example`.
- Circle's devnet USDC faucet: confirm before the Thursday 17:00 decision point.
