---
paths:
  - "src/**/*.tsx"
---

# Components

## Shape

- One component per file, kebab-case file named after it (`offer-card.tsx` → `OfferCard`).
- Function declarations, named exports, props type `<Component>Props` above the component.
- Under ~150 lines; past that, split into another file in the same feature or move logic into a
  hook.
- `components/` holds domain-agnostic pieces (`Money`, `SourceRef`, `Disclaimer`,
  `StatusBadge`); anything named after a Prickle concept (`OfferCard`, `ScoutLane`,
  `SpendReport`) lives in its feature.

## Data flow

- Feature panels read the `SessionView` from the session feature (through its `index.ts`) and
  pass plain props down. Presentational components know nothing about SSE or the reducer.
- Derive during render; don't store derived values in state. `useEffect` only to sync with
  something outside React (the `EventSource`, focus management).
- Early-return for empty, connecting and failed states instead of nested ternaries.
- `key` is a stable id from the data (event id, offer id, agent name), never the index.
- Handlers are `handleX` inside, `onX` as props. No business logic inline in JSX.

## The timeline (the concurrency proof)

- One lane per agent, ordered: 5 scouts, budget, deal verifier, merchant risk, reviewer, guard.
  Bars span `scout.started` → `scout.finished` (or the agent's first → last event) on a shared
  time axis from the session's first event.
- It must make "five at once" obvious at a glance on a projector: overlapping bars, a visible
  wall-clock vs. summed-time label taken from the backend's numbers if it emits them.
- Animations respect `prefers-reduced-motion`.

## Keep it small

No component library, no charting library, no router, no global store unless asked: plain
elements and Tailwind are enough for one page. Ask before adding any dependency.
