---
name: verify
description: Run the frontend gate locally — frozen-lockfile install, typecheck, lint, unit tests and the production build. Catches what pnpm check misses, such as a bundle that won't build or a contract import that broke. Use before committing, before opening a pull request, before telling the user a task is done, or when asked whether a change works.
---

# Verify — the frontend gate

Run from `frontend/`. If a script does not exist yet (pre-scaffold), report the step as skipped
with "script missing"; do not invent a replacement.

Typecheck, lint, test and build are independent: run all four even when one fails, and report
each. Only a failed install stops the run. Run them one after another, not concurrently. Send
output to a log in the scratchpad and read it, rather than piping into `tail`.

This checks the code, it does not change it. Report failures and offer fixes; apply them only
when asked (`/pre-pr` runs this and is read-only).

1. **Install, frozen.** `pnpm install --frozen-lockfile` from the repository root (pnpm
   workspace). An outdated lockfile means a dependency changed: re-locking needs the user's OK.
2. **Typecheck.** `pnpm typecheck`. Errors inside `@prickle/backend/contracts` types mean the
   backend changed an event: report it as a contract change, and fix the UI side, not the types.
3. **Lint.** `pnpm lint` (`--fix` for the mechanical rules; offer it).
4. **Unit tests.** `pnpm exec vitest run`. No live backend needed: MSW serves recorded runs.
5. **Build.** `pnpm exec vite build`. A green typecheck is not a green bundle.

Optional, when the user asks for a live check: with the backend's `pnpm dev` running, start
`pnpm dev`, submit the default mandate, and confirm the guard decision, spend report and
disclaimer render. Say which parts were checked by eye and which were not.

## Report

One line per step: passed, failed (first relevant error, not the whole log), or skipped and why.
Label environment failures (pnpm missing, backend not running) as environment.
