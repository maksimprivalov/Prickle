---
paths:
  - "src/**/*.tsx"
  - "src/lib/format-money.ts"
  - "src/lib/explorer-url.ts"
---

# Money and sources on screen

The *Care with financial data* criterion is judged on what is visible: every number has a
source, nothing is made up, and the page says it is not financial advice.

## Showing a number

- Money renders only through `<Money value={cents} currency="EUR" source={recordId} />` (or
  `currency="USDC"` with base units). It formats with `lib/format-money.ts` and shows the source.
- Any other number (a date, a count, a fee percentage) that came from the backend renders with
  `<SourceRef recordId>` beside it.
- The source is reachable by keyboard and screen reader (a focusable element with an accessible
  description such as "Source: price history c-tv55-ph-1003"), not only on mouse hover.
- **The UI never computes money**: no sum, difference, percentage or conversion. "Spent 585 of
  600 USDC" uses the two values from `payment.settled` / the mandate as they arrived.
- If a value is missing from the event, show "unknown", never a fallback number.

## Formatting

- `lib/format-money.ts` is the only formatter: integer in, string out, `Intl.NumberFormat` on the
  integer split into whole and fractional parts by integer division. No float math, no `toFixed`
  on a price, no `Number(string)` on money.
- EUR shows two decimals; test USDC shows up to two decimals and the label "test USDC".

## Decisions and verdicts

- A verdict shows its decision as text and an icon (PASSED / REJECTED / UNVERIFIABLE), never
  colour alone, plus its reasons and their sources.
- The guard's decision is shown as received. A deny lists every reason with the values compared
  ("648.00 EUR at checkout > 600.00 EUR mandate"). Never hide or soften a deny.
- When verdicts disagree (deal verifier vs. merchant risk), show both and the reviewer's
  resolution; that disagreement is a judging point.

## Payments

- A devnet signature links to `lib/explorer-url.ts`'s URL, which always carries
  `?cluster=devnet` and accepts only base58 signatures. A mock-wallet signature (`mock-...`) is
  labelled "mock payment" and not linked.
- External links open in a new tab with `rel="noreferrer"`.

## The disclaimer

`<Disclaimer>` ("Prickle checks offers against your own rules. Not financial advice. Synthetic
stores, devnet test USDC.") is rendered on the page whenever a mandate or session is shown. Do
not remove it, hide it behind a toggle, or shrink it below body text size.
