import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { Mandate } from '@core/mandate';
import type { RunLogLine } from '@runtime/run-log';
import type { SessionHub } from './session-hub';

// The frontend's only API (frontend/.claude/rules/event-stream.md):
//   POST /api/sessions               the mandate in, { sessionId } out
//   GET  /api/sessions/:id/events    SSE: one message per event of the run, replayed from the
//                                    start for late subscribers; closes after session.ended
// Each message's data is one event from the contracts (@prickle/backend/contracts) and its id is
// the run-log sequence number, so a reconnecting EventSource resumes after Last-Event-ID.

export const FRONTEND_ORIGIN = 'http://localhost:5173';

/** "live" runs agents on a model; "replay" streams a recorded run, and says so. */
export type ServerMode = 'live' | 'replay';

const LastEventId = z.coerce.number().int().min(-1).catch(-1);

export function createSessionApp(
  hub: SessionHub,
  options: { readonly mode?: ServerMode; readonly origins?: readonly string[] } = {},
): Hono {
  const mode = options.mode ?? 'live';
  const app = new Hono();
  app.use('/api/*', cors({ origin: [FRONTEND_ORIGIN, ...(options.origins ?? [])] }));

  app.get('/api/health', (c) => c.json({ ok: true, mode }));

  app.post('/api/sessions', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'The body is not JSON.' }, 400);
    }
    const mandate = Mandate.safeParse(body);
    if (!mandate.success) {
      return c.json({ error: 'Invalid mandate.', issues: mandate.error.issues }, 400);
    }
    const started = hub.start(mandate.data);
    if (!started.ok) {
      return c.json(
        {
          error: 'A session is already running; try again when it has ended.',
          sessionId: started.runningSessionId,
        },
        409,
      );
    }
    return c.json({ sessionId: started.sessionId, mode }, 201);
  });

  app.get('/api/sessions/:id/events', (c) => {
    const sessionId = c.req.param('id');
    const afterSeq = LastEventId.parse(c.req.header('Last-Event-ID') ?? -1);
    // Probe first, so an unknown session is a plain 404 rather than an empty stream.
    const probe = hub.subscribe(
      sessionId,
      Number.MAX_SAFE_INTEGER,
      () => undefined,
      () => undefined,
    );
    if (!probe) return c.json({ error: 'No such session.' }, 404);
    probe();

    return streamSSE(c, async (stream) => {
      let writes = Promise.resolve();
      let finish!: () => void;
      const ended = new Promise<void>((resolve) => (finish = resolve));
      const send = (line: RunLogLine) => {
        if (line.kind !== 'event') return;
        writes = writes.then(() =>
          stream.writeSSE({ id: String(line.seq), data: JSON.stringify(line.event) }),
        );
      };
      const unsubscribe = hub.subscribe(sessionId, afterSeq, send, () => finish());
      stream.onAbort(() => {
        unsubscribe?.();
        finish();
      });
      await ended;
      await writes;
      unsubscribe?.();
    });
  });

  return app;
}
