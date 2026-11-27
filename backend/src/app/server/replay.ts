import { PrickleEvent } from '@core/events';
import type { RunLogLine } from '@runtime/run-log';
import type { SessionRunner } from './session-hub';

// Replays a recorded run log as a session: the same events, in the same order, with their
// recorded timestamps, paced by the recorded gaps divided by `speed`. No model is called, so
// screenshots, the demo video and a public server cost no quota. The server labels every
// replayed session as a replay (mode "replay"), and the page shows it.

export const REPLAY_MAX_GAP_MS = 8_000;

export function createReplayRunner(options: {
  readonly lines: readonly RunLogLine[];
  /** 1 = recorded pace, 4 = four times faster. */
  readonly speed: number;
  readonly sleep?: (ms: number) => Promise<void>;
}): SessionRunner {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const speed = Math.max(options.speed, 0.1);

  return async ({ sessionId, log }) => {
    let previous: number | undefined;
    for (const line of options.lines) {
      const at = Date.parse(line.at);
      if (previous !== undefined) {
        // Long waits for a free-tier request slot are shortened, so the replay stays watchable.
        const gap = Math.min(Math.max(0, at - previous) / speed, REPLAY_MAX_GAP_MS);
        if (gap > 0) await sleep(Math.round(gap));
      }
      previous = at;
      if (line.kind === 'event') {
        const event = PrickleEvent.safeParse(line.event);
        if (!event.success) continue;
        log.append({ ...line, sessionId, event: { ...event.data, sessionId } });
      } else {
        log.append({ ...line, sessionId });
      }
    }
  };
}
