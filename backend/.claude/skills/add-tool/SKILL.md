---
name: add-tool
description: Add a Prickle tool — a plain async function with zod input and output that returns records with stable recordIds into the run's record registry — plus its mock-store endpoint if needed and its tests. Use when an agent needs a new piece of data (catalog, price history, checkout total, store profile) or a computed value with a source.
argument-hint: "<tool name, e.g. checkout_total>"
---

# Add a tool

Read `.claude/rules/tools.md` first.

1. **Name and job.** One tool, one question (`price_history`, `checkout_total`, `store_profile`).
   snake_case tool name; file `src/tools/<kebab-name>.ts`.
2. **Schemas.** Input and output zod schemas. Output records reuse `core/` schemas and each carries
   a stable `recordId` (`<store>-<offer>-<kind>-<n>`). Money as `Cents`.
3. **Data source.** If the data comes from a store, add or extend the endpoint in
   `src/mock-stores/` in that store's own response shape, reading `data/fixtures/`. If the
   fixtures lack the data, change `scripts/gen-data.ts` and run `pnpm gen:data` — never edit
   fixtures by hand.
4. **`run`.** Validate input; call the store over HTTP; parse that store's format into core
   types; register every returned record in `ctx.records`; validate output; return a typed
   failure (`{ ok: false, reason }`) on store errors instead of throwing.
5. **Computed values.** If the tool computes a number (a sum, a 30-day minimum), the computation
   is a pure function in `core/`, and the tool returns its result as a record citing the input
   record ids. That is how a derived number stays grounded.
6. **Tests** next to the tool: the parser against the store's real fixture shape, the failure
   path, and record ids stable across two runs.
7. **Wire it** into the agent spec(s) that need it; the adapter wraps it as a Mozaik
   `FunctionTool` (check the signature in the installed `.d.ts`).
8. Run `/verify`.
