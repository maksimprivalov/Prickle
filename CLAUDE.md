# Prickle

A team of AI agents that shops for you on Black Friday, pays from a capped wallet, and never
spends more than you allowed. Mozaik Black Friday AI Hackathon, 26–27 November 2026, category
Agentic Payments. Team: Maksim Privalov (payments core), Tara Petričić (data, agents, story).

The full idea, design, scoring and plan are in [`prickle-idea.md`](prickle-idea.md). It is the
design document: read the section a task needs, not the whole file (`/idea <section>` in
`backend/` prints one).

## Where the work lives

| Folder | What | Start Claude Code here for |
| --- | --- | --- |
| [`backend/`](backend/) | TypeScript on Node: agents on `@mozaik-ai/core`, mandate guard, tools, mock stores, payments, synthetic data, eval, CLI and SSE server | anything but the UI |
| [`frontend/`](frontend/) | Vite + React page that sends a mandate and streams the run over SSE. Optional: the first thing to cut | the UI |

Each folder has its own `CLAUDE.md`, `README.md` and `.claude/` (settings, hooks, rules, skills).
**Start Claude Code inside `backend/` or `frontend/`, not here**: project settings, hooks and
permissions load from the folder a session starts in.

The root is a pnpm workspace over the two packages, so `pnpm install && pnpm demo` from the root
is the judge's path (fix 3 in the idea).

## Rules that hold everywhere

- Synthetic or public data only. Solana **devnet** only, test USDC only. Never mainnet, never a
  real card or account.
- Money is integers: euro cents and USDC base units (6 decimals). Never a float.
- Every number shown to a user points to the record it came from.
- Every output that recommends or pays states that it is **not financial advice**.
- `@mozaik-ai/core` is imported only in `backend/src/runtime/mozaik/`.
- Never commit a secret: LLM keys and wallet keypairs stay in gitignored files.
- `LICENSE` is the agreed all-rights-reserved license; do not change it.
- All documentation is in English, whatever language the conversation is in.
