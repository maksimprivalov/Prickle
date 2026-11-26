---
name: verify
description: Run the backend gate locally — frozen-lockfile install, typecheck, lint (including the Mozaik import boundary), unit tests, and a judge-mode smoke run of pnpm demo on the mock wallet. Use before committing, before opening a pull request, before telling the user a task is done, or when asked whether a change works.
argument-hint: "[--no-demo]"
---

# Verify — the gate, locally

Run from `backend/`. If a script below does not exist yet (pre-scaffold), report the step as
skipped with "script missing" — do not invent a replacement command.

Typecheck, lint and test are independent: run all three even when one fails, and report each.
Only a failed install stops the run. Run them one after another, not concurrently. Send output to
a log file in the scratchpad and read it, rather than piping into `tail` (the pipe's exit code is
`tail`'s).

This checks the code, it does not change it. Report failures and offer fixes; apply them only
when asked.

1. **Install, frozen.** `pnpm install --frozen-lockfile` (from the repository root: it is a pnpm
   workspace). `ERR_PNPM_OUTDATED_LOCKFILE` means `package.json` changed without its lockfile;
   re-locking is a dependency change, so ask first.

2. **Typecheck.** `pnpm typecheck`

3. **Lint.** `pnpm lint`. A `no-restricted-imports` error on `@mozaik-ai/core` is a design
   violation, not a lint nit: the import belongs in `src/runtime/mozaik/` behind a port method.
   Never disable the rule to get green. `pnpm lint --fix` resolves the mechanical rules; offer it.

4. **Unit tests.** `pnpm exec vitest run`. No network and no LLM are needed; a test that needs
   one is a bug in the test. Report counts, and name every failing test.

5. **Judge-mode smoke run** — skip with `--no-demo`. `pnpm demo` with `PAYMENTS` unset (mock
   wallet). It needs the LLM key in `.env`: check presence with `test -f .env`, never read or
   print it. Without it, report the step as skipped (environment), not failed. Pass means:
   exit code 0, a guard decision printed, a spend report that never exceeds the mandate, and the
   "not financial advice" line. Quote the spend report line.

## Report

One line per step: passed, failed (with the first relevant error, not the whole log), or skipped
and why. Label environment failures (no LLM key, no network, pnpm missing) as environment, so they
are not read as a broken change.
