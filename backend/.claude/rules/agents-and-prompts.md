---
paths:
  - "src/agents/**/*.ts"
  - "src/prompts/**/*.md"
---

# Agents and prompts

## Agents are plain data

An agent spec is an object, not a class and not a Mozaik call:

```ts
export const dealVerifier = {
  name: 'deal-verifier',
  prompt: 'deal-verifier.md',          // file in src/prompts/
  model: ModelTier.Strong,              // Fast for scouts, Strong for reviewer/checkers
  tools: [priceHistoryTool],
  output: dealVerdictSchema,            // zod, from core/verdicts
  reactsTo: [EventName.OfferFound],     // or startsWith: 'session' for loops
  emits: [EventName.VerdictReady],
} satisfies AgentSpec;
```

- `src/agents/` never imports `@mozaik-ai/core`. `runtime/mozaik/` turns specs into Mozaik agents.
- One spec per file, file named after the agent (`deal-verifier.ts`).
- The planned agents: `scout` (one spec, five instances, one per store, each with its own store
  tool), `budget`, `deal-verifier`, `merchant-risk`, `reviewer`. A new one: `/add-agent`.

## Concurrency must be real

The judges score "agents really run at the same time" highest, and the risk named in the idea is
"the 5 scouts are one agent in a loop". So:

- The 5 scouts are 5 agent instances started together, each with its own store, own tool and
  own response shape to deal with. Never one agent iterating over stores.
- Checkers react to `offer.found` as offers appear; they do not wait for all scouts to finish.
- When deal verifier and merchant risk disagree on an offer, the reviewer resolves it and the
  decision is logged (fix 4). Don't paper over disagreement in a prompt.

## Outputs

- Every agent output is a zod schema from `core/`, parsed before anyone trusts it. A parse
  failure is logged and the output dropped; never "repair" it with a regex.
- Outputs carry `sources: recordId[]` for every number, and go through `core/grounding` before
  the reviewer. An agent may not compute a number a tool did not return (sum, difference,
  percentage): add a tool or a core function that computes it and returns a record.
- Verdicts that decide something (fake discount, hidden fee, guard) come from code in `core/`.
  The agent's job is to gather, explain and cite.

## Prompts

- One `.md` per agent in `src/prompts/`, named like the agent. Plain English.
- Structure: role in one line; what it receives; what it must output (field by field, matching
  the schema); rules (cite record ids, never invent a number, say "unknown" when a tool did not
  return it); one short example with synthetic values.
- No prices, store names or thresholds hardcoded in a prompt: they come from the mandate and the
  tools at run time.
- Every user-facing explanation the agent writes ends with, or is followed by, the
  not-financial-advice line.
- Keep prompts short. A rule that matters is enforced in code; the prompt only explains it.
