// Keeps one model under N requests per rolling minute. Gemini's free tier allows 15 requests per
// minute per model; a demo session makes about 25, most of them in the first seconds, so without
// this the last agents get 429 and fail. Calls over the limit wait their turn instead.

const MINUTE_MS = 60_000;

export type RequestLimiter = { acquire(): Promise<void> };

export function createRequestLimiter(options: {
  /** 0 or less turns the limiter off. */
  readonly perMinute: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): RequestLimiter {
  const { perMinute } = options;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  if (perMinute <= 0) return { acquire: () => Promise.resolve() };

  const starts: number[] = [];
  // One waiter at a time, so calls get their turn in the order they asked.
  let queue: Promise<void> = Promise.resolve();

  async function waitForSlot(): Promise<void> {
    for (;;) {
      const t = now();
      while (starts.length > 0 && (starts[0] ?? t) <= t - MINUTE_MS) starts.shift();
      const oldest = starts[0];
      if (starts.length < perMinute || oldest === undefined) {
        starts.push(t);
        return;
      }
      await sleep(oldest + MINUTE_MS - t + 50);
    }
  }

  return {
    acquire() {
      const turn = queue.then(waitForSlot);
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}
