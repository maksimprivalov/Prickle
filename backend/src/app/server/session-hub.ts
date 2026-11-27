import type { Mandate } from '@core/mandate';
import type { RunLog, RunLogLine } from '@runtime/run-log';

// Keeps every session's run log in memory so the event stream can replay it from the start
// to anyone who subscribes late, then follow it live. One session runs at a time by default:
// a session is ~30 model requests, and the free Gemini tier allows 15 per minute.

/** Runs one session to the end, writing every line to `log`. */
export type SessionRunner = (session: {
  readonly sessionId: string;
  readonly mandate: Mandate;
  readonly log: RunLog;
}) => Promise<void>;

export type StartResult =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly reason: 'busy'; readonly runningSessionId: string };

export type SessionHub = {
  start(mandate: Mandate): StartResult;
  /**
   * Replays every line after `afterSeq`, then follows the session live. `onEnd` is called once
   * the session has finished and everything was delivered. Undefined for an unknown session.
   */
  subscribe(
    sessionId: string,
    afterSeq: number,
    onLine: (line: RunLogLine) => void,
    onEnd: () => void,
  ): (() => void) | undefined;
};

type Session = {
  readonly lines: RunLogLine[];
  readonly listeners: Set<{ onLine: (line: RunLogLine) => void; onEnd: () => void }>;
  done: boolean;
};

export function createSessionHub(options: {
  readonly run: SessionRunner;
  readonly newSessionId: () => string;
  /** Also writes each session's log elsewhere, e.g. runs/<session>.jsonl. */
  readonly archive?: (sessionId: string) => RunLog;
  readonly maxRunning?: number;
  /** Told about a runner that threw, so the server can log it. */
  readonly onError?: (sessionId: string, error: unknown) => void;
}): SessionHub {
  const sessions = new Map<string, Session>();
  const maxRunning = options.maxRunning ?? 1;

  function running(): string[] {
    return [...sessions].filter(([, s]) => !s.done).map(([id]) => id);
  }

  return {
    start(mandate) {
      const busy = running();
      const [first] = busy;
      if (busy.length >= maxRunning && first !== undefined) {
        return { ok: false, reason: 'busy', runningSessionId: first };
      }
      const sessionId = options.newSessionId();
      const session: Session = { lines: [], listeners: new Set(), done: false };
      sessions.set(sessionId, session);
      const archive = options.archive?.(sessionId);
      const log: RunLog = {
        append(line) {
          archive?.append(line);
          session.lines.push(line);
          for (const listener of session.listeners) listener.onLine(line);
        },
      };
      void options
        .run({ sessionId, mandate, log })
        .catch((error: unknown) => options.onError?.(sessionId, error))
        .finally(() => {
          session.done = true;
          for (const listener of session.listeners) listener.onEnd();
          session.listeners.clear();
        });
      return { ok: true, sessionId };
    },

    subscribe(sessionId, afterSeq, onLine, onEnd) {
      const session = sessions.get(sessionId);
      if (!session) return undefined;
      for (const line of session.lines) if (line.seq > afterSeq) onLine(line);
      if (session.done) {
        onEnd();
        return () => undefined;
      }
      const listener = { onLine, onEnd };
      session.listeners.add(listener);
      return () => session.listeners.delete(listener);
    },
  };
}
