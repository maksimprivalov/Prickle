// Shown when the server streams a recorded run instead of running the agents (pnpm dev:replay,
// or a public deployment): the page must never pass a replay off as a live run.
export function ReplayBanner() {
  return (
    <p
      role="note"
      className="rounded-lg border-2 border-unverified bg-surface px-4 py-3 text-lg text-ink"
    >
      <strong>Replay of a recorded live run.</strong> The server is streaming a run recorded on 27
      November 2026 (runs/sample-run.jsonl): no model is called now, and the recorded mandate is
      shown, whatever was entered.
    </p>
  );
}
