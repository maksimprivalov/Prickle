---
name: add-agent
description: Add or change a Prickle agent end to end — output schema in core, prompt in src/prompts, agent spec in src/agents, any tools it needs, wiring in the Mozaik adapter (loop, situation handler or reviewer), run-log events, and tests. Use when building a scout, the budget agent, deal verifier, merchant-risk agent, reviewer, or any new agent.
argument-hint: "<agent name, e.g. merchant-risk>"
---

# Add an agent

Work in this order; each step builds on the one before. Read `.claude/rules/agents-and-prompts.md`
first.

## 0. Place it in the design

- Print the idea's Mozaik design: `/idea Mozaik design`. Decide which kind this agent is:
  - **loop** — started with `runLoop` at session start, concurrently with the others (scouts,
    budget);
  - **situation handler** — reacts to an event as it appears (deal verifier and merchant risk on
    `offer.found`);
  - **reactive reviewer** — reacts to other agents' answers (reviewer).
- Decide which numbers it reports and which tool returns each one. A number with no tool is a
  missing tool (`/add-tool`) or a missing `core` function, never something the LLM computes.
- Decide what is **decided in code** (`core/deal`, `core/guard`) vs. **explained by the agent**.
- If the agent touches money, the guard or grounding, run the `design-reviewer` agent on the
  plan before writing code.

## 1. `core/` — the output contract

- The output schema in `core/verdicts/` (or the relevant folder), inferred type next to it. It
  includes `sources: recordId[]` and, for user-facing text, the explanation string.
- Any new event in `core/events/` (`<noun>.<past-verb>`), added to the union. That is a frontend
  contract change: note it for step 6.
- Unit tests for any core function added.

## 2. Tools

Every tool the agent needs exists with a zod input/output and returns records with `recordId`
(`/add-tool` for a new one).

## 3. The prompt — `src/prompts/<name>.md`

Role in one line; inputs; output field by field matching the schema; rules (cite record ids,
never invent or compute a number, "unknown" when a tool did not return it, not financial advice
on user-facing text); one short synthetic example. No hardcoded prices, stores or thresholds.

## 4. The spec — `src/agents/<name>.ts`

`name`, `prompt`, `model` tier (Fast for scouts, Strong for reviewer and checkers), `tools`,
`output`, `reactsTo` / start mode, `emits`. No Mozaik import.

## 5. The adapter — `src/runtime/mozaik/`

- Read the installed Mozaik `.d.ts` before writing the call (`mozaik-runtime.md`).
- Loops start without awaiting each other; handlers subscribe to the event; outputs go through
  `core/grounding` before anyone else sees them; every emitted event reaches the run log.
- If the agent's output feeds a payment, the guard interception still sits in front of `pay()`.

## 6. Prove it

- Tests for the core logic and the tools (`testing.md`). The LLM itself is not unit-tested.
- `pnpm demo`: the new agent's events appear in the terminal and the run log, interleaved with
  the others (concurrency visible), and nothing in the spend report changed unexpectedly.
- If an event schema changed, update `../frontend` in the same change, or tell the user exactly
  what it must handle.
- Run `/verify` and report each step.
