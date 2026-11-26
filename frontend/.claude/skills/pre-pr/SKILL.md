---
name: pre-pr
description: Read-only review of everything on this branch that is not upstream yet (commits plus staged, unstaged and untracked files) against the frontend rules — sources on every number, no money math, disclaimer, devnet-only links, contracts imported not copied, accessibility essentials — with the /verify gate and a suggested PR description. Use before opening a pull request.
allowed-tools: Bash(git *) Bash(pnpm *) Read Grep Glob
disable-model-invocation: true
---

# Pre-PR review

Review the work as a reviewer would. **Read-only: report findings, fix nothing** unless asked
afterwards.

## 0. The review set

- **Uncommitted:** `git diff`, `git diff --staged`, and untracked files from
  `git status --porcelain` (read those in full).
- **Committed:** base = `git merge-base HEAD origin/main` (else `main`; if you are on `main`, use
  `@{u}`; if nothing resolves, say so and review all commits). Commits: `git log --oneline
  <base>..HEAD`; diff: `<base>...HEAD`.
- Where a file appears in both, review its current on-disk state. Mark uncommitted findings "not
  committed yet".

## 1. Gate

Run `/verify` and report its real per-step output. A code failure is a blocker; an environment
failure is not, but say the step went unverified.

## 2. Review against the rules

The relevant `.claude/rules/*.md` load as you read matching files; check against them, not
general React habits. Specifically:

- **Sources and money:** every money value through `<Money>` with a source; no sum, difference,
  percentage or conversion of money in the UI; no float on money; missing value shows "unknown".
- **Disclaimer** present wherever a mandate or session is shown.
- **Guard:** decisions shown as received, every deny reason visible, nothing softened.
- **Links:** explorer URLs only from `lib/explorer-url.ts`, `?cluster=devnet`; mock signatures
  unlinked.
- **Contracts:** event/mandate types imported from `@prickle/backend/contracts`, never copied;
  every SSE message parsed; unknown events skipped, not crashing.
- **State:** the view is `reduceEvents(events)`; no event data copied into other state; the only
  effect opening a network connection is the `EventSource`.
- **Structure:** feature boundaries through `index.ts`, `lib/` and `components/` not importing
  features, one component per file, named exports, no `any`, no `enum`.
- **Accessibility:** labels, keyboard reach (including source references), focus visible, live
  region for milestones, colour never the only signal, reduced motion.
- **Security:** nothing secret in `VITE_*`, `.env.example`, fixtures or handlers.
- **Tests:** new behaviour tested against recorded runs; nothing skipped or weakened; no `.only`,
  stray `console.log` or debug code.
- **Hygiene:** dependency changes flagged (they need agreement); drive-by refactors and
  speculative abstraction flagged.

## 3. Report

```text
## Scope reviewed      <base and why, commits, uncommitted files>
## Gate (/verify)      <one line per step>
## Blockers            <file:line, why, the fix>
## Should fix
## Nits                <optional, say so>
## Needs a human       <what only a browser or keyboard pass can settle>
## Suggested PR description   <what and why; changes; how to verify>
```

Empty section → one line saying so. Only report what you confirmed by reading the code.
