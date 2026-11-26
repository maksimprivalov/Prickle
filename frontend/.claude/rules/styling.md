---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# Styling — Tailwind CSS v4

- CSS-first config in `src/styles/theme.css` (`@import "tailwindcss";` + `@theme`). There is no
  `tailwind.config.js`.
- Colours, radii and fonts are tokens in `@theme` (`--color-pass`, `--color-reject`,
  `--color-unverified`, `--color-surface`, `--color-ink`, …), used through utilities
  (`bg-surface`, `text-reject`). No hex value or arbitrary colour (`text-[#e11]`) in a component.
- Light and dark: tokens are redefined for dark under `@media (prefers-color-scheme: dark)`.
  Every colour pairing is checked for contrast in both.
- Status colours always come with text or an icon (`money-and-sources.md`).
- Conditional classes with a small `cn()` helper in `lib/`; no string concatenation spaghetti.
- No inline `style` except values known only at run time (timeline bar offsets and widths).
- Mobile-first, but the target is a laptop on a projector: large type for the decision and the
  spend report, readable from the back of a room.
- Arbitrary values (`w-[437px]`) are a smell; prefer the scale or a token.
- When unsure of a v4 API, check the Tailwind v4 docs; v3 patterns (`tailwind.config.js`,
  `@tailwind base`) are wrong here.
