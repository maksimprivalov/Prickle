---
name: add-trap
description: Plant a new trap in Prickle's synthetic data (via the seeded generator, never by hand), register it in the eval answer key traps.json with the agent expected to catch it, and prove it is caught. Use when adding a trap type or more trap instances to the dataset.
argument-hint: "<trap name, e.g. fake-scarcity>"
---

# Add a trap

Read `.claude/rules/synthetic-data.md` first. Fixtures are generated; the guard hook denies hand
edits to `data/fixtures/`.

1. **Define it.** What the store does (in data), which offer(s) it affects, and which part of
   Prickle should catch it: deal verifier (30-day rule), merchant risk, or the mandate guard. If
   nothing can catch it yet, say so: the trap is pointless until a check exists.
2. **Generator.** Extend `scripts/gen-data.ts` to plant it, seeded and deterministic, and to
   append an entry to `traps.json`: `{ trap, storeId, offerId, expectedCatcher, recordIds }`.
   Keep honest deals in the set; do not turn the demo's Store B offer into a trap.
3. **Regenerate.** `pnpm gen:data`. Check with `git diff --stat data/fixtures` that only the
   intended stores and offers changed, and that the demo's Store B / C / D example still holds.
4. **Catch it in code.** The decision lives in `core/` (deal, guard) or a merchant-risk check
   function; add the unit test for the trap's exact case there.
5. **Eval.** `pnpm eval`: the new trap appears in the table, caught by the expected catcher, and
   the honest-deals-rejected count did not rise. Then `/eval` to refresh the README tables.
6. Commit the generator, the fixtures and the test together. Run `/verify`.
