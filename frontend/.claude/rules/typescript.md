---
paths:
  - "src/**/*.{ts,tsx}"
---

# TypeScript

- `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Code that compiles only because a
  check is off is not acceptable.
- No `any`; `unknown` and narrow. No `as Foo` on data crossing a boundary (SSE messages, fetch
  responses, `JSON.parse`, URL params): parse it with the contract's zod schema.
- No TypeScript `enum`: `const` object + derived union.

  ```ts
  export const StreamState = { Connecting: 'connecting', Open: 'open', Ended: 'ended', Failed: 'failed' } as const;
  export type StreamState = (typeof StreamState)[keyof typeof StreamState];
  ```

- Types come from zod (`z.infer`), and event/mandate types from `@prickle/backend/contracts`.
  Never a hand-written copy of a backend type.
- Discriminated unions over objects with optional fields.
- `type` over `interface`; no `React.FC`; type the props parameter.
- Named exports only; `import type` for type-only imports.
- Imports: `./sibling` within a folder, aliases (`@app`, `@features`, `@components`, `@lib`,
  `@styles`, `@test`) across folders, a feature only through its `index.ts`.
- No non-null `!` except right after a check the compiler cannot follow, with a comment.
- Comments say *why*, not *what*.
- When unsure about a current API (React 19, Vite, Tailwind v4, zod 4, MSW 2), check the docs or
  the installed `.d.ts` rather than reconstructing it from memory.
