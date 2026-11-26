---
paths:
  - "src/features/session/**/*.{ts,tsx}"
  - "src/features/mandate/**/*.{ts,tsx}"
  - "src/lib/api.ts"
---

# The event stream — the only server state

The backend appends every event of a session to its run log and streams it over SSE. The page is
a pure function of that stream.

## Calls

| Call | Where |
| --- | --- |
| `POST /api/sessions` with the mandate → `{ sessionId }` | `lib/api.ts` (`startSession`), called from the mandate form's submit handler |
| `GET /api/sessions/:id/events` (SSE) | `features/session/use-session-events.ts` |

- Relative `/api/...` URLs only; Vite proxies them to the backend. No base URL in env.
- `fetch` lives only in `lib/api.ts`. It parses the response with zod and throws a typed
  `ApiError` on non-2xx; components never see a `Response`.

## Contracts

- Import event and mandate schemas from `@prickle/backend/contracts`. Never re-declare an event
  type or schema here: one definition, or the two sides drift during the hackathon.
- If the UI needs a field an event does not carry, the fix is in `backend/src/core/events` (a
  contract change, done from a backend session), not a computed field here.

## The stream hook

- `use-session-events.ts` opens one `EventSource` per `sessionId` in a `useEffect` (this is
  synchronizing with an external system, the one allowed effect) and closes it on cleanup.
- Every message is parsed with the contract's event union (`safeParse`). Invalid → logged once
  with `console.warn` and skipped; unknown type → skipped. Never crash the page on a bad event.
- Events are appended to a list held in a `useReducer`; the backend replays from the start, so
  on reconnect dedupe by event id instead of clearing.
- Stream states are a union: `connecting | open | ended | failed`. `session.ended` closes the
  stream deliberately; a dropped connection shows "reconnecting" and relies on `EventSource`'s
  own retry.

## The reducer — `reduce-events.ts`

- Pure: `(events) => SessionView`. No clock, no randomness, no fetch. Easy to unit-test from a
  recorded run log (`src/test/fixtures/*.jsonl`, copied from `backend/runs/`).
- `SessionView` holds what the panels need: agents with their start/finish times, offers with
  their verdicts and sources, the guard decision, payments. Each value keeps the `recordId` it
  came from.
- It **does not compute money**. It picks values out of events. Durations for the timeline (ms
  between two event timestamps) are the only arithmetic allowed, and they are not money.

## The mandate form

- react-hook-form with the contract's mandate schema as the resolver; `defaultValues` is the demo
  mandate (55-inch TV, max €600, real discount only, trusted stores only).
- The max price is entered in euros and converted to integer cents by one helper in `lib/`
  (string → cents, no float parsing: split on the decimal separator).
- Submit disables while pending and shows why; a failed submit shows the error near the button.
