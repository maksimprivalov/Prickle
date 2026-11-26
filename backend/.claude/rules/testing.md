---
paths:
  - "src/**/*.test.ts"
  - "test/**/*.ts"
---

# Testing — Vitest

The guard must be proven, not trusted. Tests are where that proof lives.

## What must be tested

- **`core/guard`**: every reason it can deny for, the exact boundary (`total == max` allows,
  `max + 1 cent` denies), checkout total vs. list price (Store D's €599 → €648), money already
  spent in the session, missing/invalid mandate (deny), missing verdict (deny), thrown error
  (deny). One test per trap from `traps.json` that the guard is responsible for.
- **`core/money`**: no fraction survives a conversion; unsafe integers throw; EUR cents → USDC
  units exact.
- **`core/deal`** (30-day rule): the Store C case (was €649, but €599 in October → fake), the
  Store B case (€699 for 60 days → real), a history shorter than 30 days → unverifiable.
- **`core/grounding`**: a number with a matching record passes; "was €649" against a record of
  €639 is rejected; format variants (`599`, `599.00`, `€599,00`) match the same value.
- **`payments/pay`**: a guard deny never reaches `wallet.transfer` (spy on the mock wallet).
- **Tools**: each store's parser against that store's real fixture shape.

## How

- Tests sit next to their code: `check-payment.ts` → `check-payment.test.ts`.
- Names describe behaviour: `it('denies when the checkout total exceeds the mandate by one cent')`.
- Core tests need no mocks; if one does, the code is not pure enough.
- No live LLM, no network, no devnet in `pnpm test`. Agents are tested through their tools and
  the core checks; the LLM path is exercised by `pnpm demo` and `pnpm eval`.
- Fixtures come from `data/fixtures/` (read-only) or small inline objects built with helpers in
  `test/`. Fake keys are obviously fake (`"test-key"`), never key-shaped.
- No `.only`, no `.skip` committed. Never weaken, skip or delete a test to get green.
- Every bug fix ships with a test that fails before the fix.
