---
name: add-view
description: Add or change a panel on the Prickle page that is fed by session events — extend the reducer's SessionView, build the components with Money/SourceRef for every number, announce milestones, and test it against a recorded run log. Use when building the timeline, offers, decision or spend-report panels, or showing a new event.
argument-hint: "<panel name, e.g. spend-report>"
---

# Add a view

Read `.claude/rules/event-stream.md` and `money-and-sources.md` first.

1. **Which events feed it?** Name them from `@prickle/backend/contracts`. If a field the panel
   needs is not in any event, stop: that is a backend contract change (start a session in
   `../backend/`, or tell the user exactly which event needs which field). Never compute it here.
2. **Recorded data.** Make sure `src/test/fixtures/` has a run log containing those events, copied
   from `backend/runs/` (the demo run at least; a deny run if the panel shows denials).
3. **Reducer.** Extend `SessionView` and `reduce-events.ts` to pick the values out of the events,
   keeping each value's `recordId`. Pure, no money arithmetic. Unit-test it against the fixture.
4. **Components** in `src/features/<feature>/`: one component per file; every money value via
   `<Money>`, other backend numbers with `<SourceRef>`; status as text plus icon; empty and
   in-progress states. Export the panel through the feature's `index.ts` and place it in
   `src/app/app.tsx`.
5. **Accessibility.** Headings, list/table semantics, keyboard reach of sources, and if the panel
   shows a milestone (decision, payment), a message to the shared live region.
6. **Test** the panel with MSW streaming the recorded run: it renders the right values with
   sources, the disclaimer is still present, axe passes. Then a quick keyboard-only pass.
7. Run `/verify`.
