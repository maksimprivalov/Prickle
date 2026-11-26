---
paths:
  - "src/**/*.test.{ts,tsx}"
  - "src/test/**/*"
---

# Testing — Vitest + Testing Library + MSW

## What to test, in order of value

1. **`reduce-events`** against recorded run logs in `src/test/fixtures/` (copied from
   `backend/runs/`, never hand-written): the demo run produces the expected offers, verdicts,
   guard decision and spend values with their record ids; an unknown or invalid event is
   skipped; replayed duplicates are deduped.
2. **`format-money`**: integers in, exact strings out (`58500` → `585.00`); no float path.
3. **`explorer-url`**: always `?cluster=devnet`; a `mock-` signature yields no link.
4. **Panels** with MSW streaming a recorded run over SSE: the guard decision and spend report
   appear; every money value has its source reachable by role/name; the disclaimer is present.
5. **Mandate form**: validation messages, euros → cents conversion, submit disabled while pending.

## How

- Tests sit next to their code (`offer-card.tsx` → `offer-card.test.tsx`).
- Query by role and accessible name; `data-testid` only with a comment saying why nothing else
  worked.
- `userEvent`, not `fireEvent`; `findBy*` for async, never a fixed `setTimeout`.
- Network through MSW only (handlers in `src/test/`); unhandled requests fail the test. Never mock
  `fetch` or `EventSource` directly.
- `vitest-axe` on full panels; axe passing is a floor, not conformance.
- No `.only` / `.skip` committed. Never weaken, skip or delete a test to get green.
