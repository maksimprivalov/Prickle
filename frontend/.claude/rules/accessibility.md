---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# Accessibility — the essentials

Target WCAG 2.1 AA where it is cheap, and these always:

## Structure

- One `<h1>`, headings in order; landmarks `<header>`, `<main>`, `<footer>` (the disclaimer can
  live in the footer if it stays visible).
- `<html lang="en">`; a descriptive `<title>`.
- Offers are a list (`<ul>`), the spend report a `<dl>` or table with headers, not a grid of divs.

## Keyboard and focus

- Everything works by keyboard: the form, expanding an offer, reaching each source reference.
- Visible focus on every interactive element; never `outline: none` without a replacement.
- No positive `tabIndex`.

## Live updates

The page changes on its own as events arrive, which a screen reader does not notice by itself.

- One polite live region (present in the DOM from the start) announces the milestones only:
  "5 scouts started", "Offer from Store B passed", "Guard allowed payment of 585.00 EUR",
  "Payment settled". Not every event — that would be noise.
- The guard decision and payment result are also moved into view, not only announced.
- `aria-busy` on the offers list while the session runs.

## Forms

- Every input has a `<label>`; errors in text, tied with `aria-describedby`, saying how to fix
  them; `aria-invalid` on the failing field. Focus the first invalid field on submit.
- The max price field states its unit (EUR) in the label.

## Colour and motion

- Text 4.5:1, UI boundaries and icons 3:1, in light and dark.
- Colour is never the only signal (PASSED / REJECTED are words too).
- Honour `prefers-reduced-motion` for the timeline and any transitions.

Automated checks (vitest-axe) catch about a third of issues; do one keyboard-only pass before
calling a panel done, and say what was and wasn't checked.
