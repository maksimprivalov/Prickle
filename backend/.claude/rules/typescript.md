---
paths:
  - "**/*.ts"
---

# TypeScript

- `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. ESM only. Code that compiles only
  because a check is off is not acceptable.
- No `any`; `unknown` and narrow, or a generic. No `as Foo` on data crossing a boundary (LLM
  output, HTTP, files, env, `JSON.parse`): parse it with zod.
- No TypeScript `enum`. A `const` object plus a derived union:

  ```ts
  export const EventName = { OfferFound: 'offer.found', VerdictReady: 'verdict.ready' } as const;
  export type EventName = (typeof EventName)[keyof typeof EventName];
  ```

- zod is the source of truth: declare the schema, infer the type (`z.infer`). Never a type and a
  schema side by side.
- Discriminated unions for results (`{ ok: true, ... } | { ok: false, reason }`), not objects with
  optional fields.
- `type` over `interface`; `satisfies` where you want inference and a constraint.
- Named exports only. One concept per file, file named after it, kebab-case file names.
- Relative imports within a folder; across top-level folders use the aliases
  (`@core/*`, `@agents/*`, `@tools/*`, `@runtime/*`, `@payments/*`, `@app/*`).
- `import type` for type-only imports.
- No non-null `!` except right after a check the compiler cannot follow, with a comment.
- Comments say *why*, not *what*.
- When unsure about a current API (Mozaik, Hono, @solana/web3.js, Vitest, zod 4), check the
  installed `.d.ts` or the docs; don't reconstruct it from memory.
