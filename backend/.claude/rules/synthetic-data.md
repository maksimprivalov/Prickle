---
paths:
  - "data/**"
  - "scripts/gen*.ts"
  - "src/mock-stores/**/*.ts"
---

# Synthetic data and traps

Rules allow only synthetic or public data. Everything in `data/fixtures/` is made up by a seeded
generator and committed, so every run and the eval are reproducible.

- **`data/fixtures/` is generated. Never edit it by hand** (the guard hook denies it). Change
  `scripts/gen-data.ts` and run `pnpm gen:data`; commit the script and the regenerated fixtures
  together.
- The generator takes a fixed seed. Same seed, byte-identical output. No `Math.random()`; use a
  seeded PRNG.
- Dataset: 5 stores (A–E), about 40 offers for the demo products, each with a 60-day daily price
  history, a checkout breakdown and a store profile (domain age, return policy, trusted flag).
  Dates are relative to a fixed "Black Friday" date in the generator, not to today.
- Every row has a stable `recordId` (see `tools.md`), so a re-run cites the same ids.
- Store names, products and addresses are obviously fictional. No real brand, store or person.

## Traps

Each trap is planted deliberately and listed in `data/fixtures/traps.json` with the offer it
affects and the agent expected to catch it. That file is the eval's answer key.

| Trap | What the data does | Caught by |
| --- | --- | --- |
| Fake discount | price raised weeks before, then "cut" back | deal verifier (30-day rule) |
| Hidden fee | "service fee" only in the checkout breakdown | merchant risk |
| Fake scarcity | "only 2 left!" on every product of a store | merchant risk |
| No refund policy | missing or "all sales final" | merchant risk |
| Over budget | real deal, but above the mandate | mandate guard |

- Keep honest deals in the set too (the demo's Store B offer), so the eval can count wrongly
  rejected honest deals.
- The demo's example run (Store B €585 passes; Store C fake discount; Store D €49 fee) must stay
  reproducible: a generator change that breaks it is a regression.
- New trap: `/add-trap`.
