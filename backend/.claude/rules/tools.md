---
paths:
  - "src/tools/**/*.ts"
  - "src/mock-stores/**/*.ts"
---

# Tools and the mock store API

## Tools are plain async functions

```ts
export const priceHistoryTool = {
  name: 'price_history',
  description: 'Daily prices for one offer over the last 60 days.',
  input: z.object({ storeId: StoreId, offerId: z.string() }),
  output: z.object({ rows: z.array(priceHistoryRowSchema) }),   // each row has recordId
  run: async (input, ctx) => { ... },
} satisfies ToolSpec;
```

- No `@mozaik-ai/core` import; the adapter wraps a `ToolSpec` as a Mozaik `FunctionTool`.
- Validate input with the schema before doing anything, and the output before returning it.
- **Every record returned has a stable `recordId`** (`<store>-<offer>-<kind>-<n>`, e.g.
  `c-tv55-ph-1003`) and is appended to the run's record registry (`ctx.records`), which the
  grounding check reads. A tool that returns a number without a record id breaks fix 1.
- Prices come back as `Cents`. The parsing of each store's format lives in that store's tool.
- Tools read the store over HTTP (`mock-stores`), not from `data/fixtures` directly, so the demo
  shows real calls and x402 can be added later without touching agents.
- Errors: a store that is down or returns garbage yields a typed failure result
  (`{ ok: false, reason }`) the agent can report, never a thrown error that kills the loop.
- `pay()` is a tool too, but it lives in `src/payments/` and calls `core/guard` itself
  (`payments.md`).

## The mock store API (`src/mock-stores/`)

- One Hono app serving Stores A–E under `/stores/<id>/...`, reading `data/fixtures/`.
- **Each store answers in a different shape** (fix 4), so each scout has real work: e.g. A clean
  JSON, B paged catalog, C messy product text, D JSON with checkout fees only at
  `/checkout`, E HTML-ish listing. Keep the shapes fixed once the scouts parse them.
- Deterministic: same fixtures, same answers. Optional per-store latency (seeded) makes the
  parallel timeline visible; never random without a seed.
- The traps (fake discount, hidden fee, fake scarcity, no refund policy) live in the data, not in
  branches of the server code.
