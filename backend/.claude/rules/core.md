---
paths:
  - "src/core/**/*.ts"
---

# `src/core/` — the part that must be right

`core/` holds what the judges, the user and the wallet trust: domain types, events, money math,
the mandate guard, the number-grounding check and the EU 30-day rule. It is plain TypeScript
plus zod. It is also the contract the frontend imports, so it must stay importable in a browser.

## No framework, no I/O

- Imports allowed: `zod` and other files in `core/`. Nothing else: no `@mozaik-ai/core`, no
  `@solana/*`, no `hono`, no `node:*`, no `fs`, no `fetch`, no `process.env`, no `Date.now()` or
  `Math.random()` (take the clock and the seed as arguments).
- Every function here is pure and deterministic, so it can be unit-tested without mocks and the
  eval is reproducible.

## Folders

```text
core/
  money/       Cents, UsdcUnits (branded integers), toUsdcUnits(), format only at the edge
  mandate/     Mandate schema (what the user set), never derived from agent output
  offers/      Offer, PriceHistoryRow, CheckoutBreakdown, StoreProfile (all with recordId)
  events/      every event schema + the union; index.ts is the frontend contract
  verdicts/    Verdict schema: decision, reasons, sources[] (record ids)
  guard/       checkPayment(mandate, offer, verdicts, wallet) -> Allow | Deny(reasons)
  grounding/   checkGrounding(output, toolRecords) -> ok | rejected(unsourced numbers)
  deal/        omnibus30Day(history, wasPrice, reductionStart) -> verdict + rows used
```

Create a folder when the first file needs it.

## Money

- `Cents` and `UsdcUnits` are branded `number`s that are always safe integers. Constructors
  validate (`Number.isSafeInteger`, ≥ 0) and throw otherwise.
- Arithmetic only through helpers in `money/` (`add`, `sub`, `lte`, `sum`). No `* 1.0`, no
  division that can produce a fraction, no `Math.round` to "fix" a value.
- EUR → test USDC is one function with one fixed rate (1 EUR = 1 test USDC, so 1 cent =
  10 000 base units). The rate is stated in the spend report.
- Parsing a price string from a store ("€ 599,00", "599.00 EUR") happens in the tool that reads
  that store, into `Cents`, never in core and never in an agent.

## The mandate guard

- `checkPayment` returns a discriminated union, never a boolean: `{ allow: true }` or
  `{ allow: false, reasons: GuardReason[] }`, each reason with the values compared and their
  record ids, so "why it fails" can be shown to the user.
- Checks, all of them, every time: total at checkout (not list price) ≤ mandate max minus what is
  already spent; store is trusted per the mandate's rule; discount verified by the 30-day rule
  when the mandate asks for a real discount; offer matches the mandate's product constraints;
  wallet balance covers it.
- The mandate comes from shared state as the user set it. A field an agent produced never widens
  it. If the mandate is missing or fails its schema, deny.
- Fail closed: an unknown case, a missing verdict or a thrown error is a deny, never an allow.
- Every branch has a test (`testing.md`). Touching this folder: have the `design-reviewer` agent
  check the change.

## Number grounding (fix 1)

- Input: an agent output (text + structured claims) and the records every tool returned in this
  run, each with `recordId`.
- Every number in the output (prices, fees, dates, percentages, balances) must equal a value in a
  record the output cites. Normalise formats (`599`, `599.00`, `€599`, `599,00`) before comparing;
  never round to make a match.
- Result is `ok` or `rejected` with the offending numbers; the runtime drops rejected output
  before the reviewer sees it and logs `grounding.rejected`.

## The EU 30-day rule (fix 2)

- "Real discount" means: the advertised "was" price is not above the lowest price in the 30 days
  before the reduction started (Omnibus Directive, Art. 6a). Compute it from the price-history
  rows; return the rows used, so the verdict cites them.
- A history shorter than 30 days before the reduction is `unverifiable`, not `real`.
- The LLM deal-verifier agent explains this verdict in words. It does not compute it.

## Events

- One zod schema per event in `events/`, named `<noun>.<past-verb>` (`offer.found`,
  `verdict.ready`, `payment.requested`, `payment.settled`, `guard.decided`, `grounding.rejected`,
  `scout.started`, `scout.finished`, `session.ended`).
- Every event carries `sessionId`, `at` (ISO string, set by the caller) and `agent` (who emitted
  it). Payloads cite `recordId`s for every number.
- Changing an event schema changes the frontend contract and the run log format: say so, and
  update the frontend in the same change.
