import { describe, expect, it } from 'vitest';
import { fixtures } from '@test/fixtures';
import { PrickleEvent } from '@core/events';
import { NOT_FINANCIAL_ADVICE } from '@core/disclaimer/disclaimer';
import { usdcUnits } from '@core/money';
import { createMockWallet } from '@payments/mock-wallet';
import { createPlainRuntime } from '@runtime/plain/plain-runtime';
import type { RunLog } from '@runtime/run-log';
import { createMockStoresApp } from '../../mock-stores/app';
import { loadFixtures } from '../../mock-stores/fixtures';
import { runSession, type SessionState } from '../run-session';
import { FRONTEND_ORIGIN, createSessionApp } from './app';
import { createSessionHub, type SessionRunner } from './session-hub';

const at = '2026-11-27T12:00:00.000Z';
const started = (sessionId: string) => ({
  type: 'session.started' as const,
  sessionId,
  at,
  agent: 'app',
  mandate: fixtures.mandate,
});
const ended = (sessionId: string) => ({
  type: 'session.ended' as const,
  sessionId,
  at,
  agent: 'app',
  outcome: { kind: 'failed' as const, detail: 'test' },
  disclaimer: NOT_FINANCIAL_ADVICE,
});

/** A runner the test drives: it writes what it is told, and ends when `finish()` is called. */
function controlledRunner() {
  let log: RunLog | undefined;
  let sessionId = '';
  let seq = 0;
  let finish: () => void = () => undefined;
  const runner: SessionRunner = (session) => {
    log = session.log;
    sessionId = session.sessionId;
    return new Promise<void>((resolve) => (finish = resolve));
  };
  const write = (line: object) => log?.append({ seq: seq++, at, sessionId, ...line } as never);
  return {
    runner,
    event: (event: object) => write({ kind: 'event', event }),
    loop: () => write({ kind: 'loop.started', agent: 'scout-a', loopId: 'scout-a#1' }),
    finish: () => finish(),
    sessionId: () => sessionId,
  };
}

let ids = 0;
function server(run: SessionRunner) {
  const hub = createSessionHub({ run, newSessionId: () => `web-${++ids}` });
  const app = createSessionApp(hub);
  const post = (body: string) =>
    app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  return { app, post };
}

/** The SSE messages of a finished stream: their id and parsed data. */
async function messages(response: Response) {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const field = (name: string) =>
        block
          .split('\n')
          .find((l) => l.startsWith(`${name}:`))
          ?.slice(name.length + 1)
          .trim();
      return { id: field('id'), data: JSON.parse(field('data') ?? 'null') as unknown };
    });
}

describe('POST /api/sessions', () => {
  it('starts a session for a valid mandate', async () => {
    const run = controlledRunner();
    const { post } = server(run.runner);
    const response = await post(JSON.stringify(fixtures.mandate));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      sessionId: expect.stringMatching(/^web-\d+$/) as string,
      mode: 'live',
    });
  });

  it('says so when the server replays a recorded run', async () => {
    const hub = createSessionHub({ run: controlledRunner().runner, newSessionId: () => 'r-1' });
    const app = createSessionApp(hub, { mode: 'replay' });
    const response = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fixtures.mandate),
    });
    expect(await response.json()).toEqual({ sessionId: 'r-1', mode: 'replay' });
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, mode: 'replay' });
  });

  it('also allows the origins it is given, e.g. a deployed domain', async () => {
    const hub = createSessionHub({ run: controlledRunner().runner, newSessionId: () => 'r-2' });
    const app = createSessionApp(hub, { origins: ['https://prickle.example.com'] });
    const response = await app.request('/api/health', {
      headers: { Origin: 'https://prickle.example.com' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://prickle.example.com');
  });

  it('refuses a body that is not JSON, or not a mandate', async () => {
    const { post } = server(controlledRunner().runner);
    expect((await post('{oops')).status).toBe(400);
    const bad = await post(JSON.stringify({ ...fixtures.mandate, maxTotal: 600.5 }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'Invalid mandate.' });
  });

  it('runs one session at a time, and accepts the next once it has ended', async () => {
    const run = controlledRunner();
    const { post } = server(run.runner);
    expect((await post(JSON.stringify(fixtures.mandate))).status).toBe(201);
    const busy = await post(JSON.stringify(fixtures.mandate));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ sessionId: run.sessionId() });
    run.finish();
    await new Promise((done) => setTimeout(done, 0));
    expect((await post(JSON.stringify(fixtures.mandate))).status).toBe(201);
  });

  it('allows the frontend origin only', async () => {
    const { app } = server(controlledRunner().runner);
    const from = async (origin: string) =>
      (await app.request('/api/health', { headers: { Origin: origin } })).headers.get(
        'access-control-allow-origin',
      );
    expect(await from(FRONTEND_ORIGIN)).toBe(FRONTEND_ORIGIN);
    expect(await from('https://evil.example')).not.toBe('https://evil.example');
  });
});

describe('GET /api/sessions/:id/events', () => {
  it('streams the events live, with run-log ids, and closes after the session ends', async () => {
    const run = controlledRunner();
    const { app, post } = server(run.runner);
    const { sessionId } = (await (await post(JSON.stringify(fixtures.mandate))).json()) as {
      sessionId: string;
    };
    run.event(started(sessionId));
    const stream = app.request(`/api/sessions/${sessionId}/events`);
    run.loop(); // runtime lines are not events: not sent
    run.event(ended(sessionId));
    run.finish();
    const response = await stream;
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const got = await messages(response);
    expect(got.map((m) => m.id)).toEqual(['0', '2']);
    for (const m of got) expect(PrickleEvent.safeParse(m.data).success).toBe(true);
    expect(got.map((m) => (m.data as { type: string }).type)).toEqual([
      'session.started',
      'session.ended',
    ]);
  });

  it('replays the whole run to a subscriber who comes after it ended', async () => {
    const run = controlledRunner();
    const { app, post } = server(run.runner);
    const { sessionId } = (await (await post(JSON.stringify(fixtures.mandate))).json()) as {
      sessionId: string;
    };
    run.event(started(sessionId));
    run.event(ended(sessionId));
    run.finish();
    await new Promise((done) => setTimeout(done, 0));
    const got = await messages(await app.request(`/api/sessions/${sessionId}/events`));
    expect(got.map((m) => m.id)).toEqual(['0', '1']);
  });

  it('resumes after Last-Event-ID', async () => {
    const run = controlledRunner();
    const { app, post } = server(run.runner);
    const { sessionId } = (await (await post(JSON.stringify(fixtures.mandate))).json()) as {
      sessionId: string;
    };
    run.event(started(sessionId));
    run.event(ended(sessionId));
    run.finish();
    await new Promise((done) => setTimeout(done, 0));
    const got = await messages(
      await app.request(`/api/sessions/${sessionId}/events`, { headers: { 'Last-Event-ID': '0' } }),
    );
    expect(got.map((m) => m.id)).toEqual(['1']);
  });

  it('answers 404 for an unknown session', async () => {
    const { app } = server(controlledRunner().runner);
    expect((await app.request('/api/sessions/nope/events')).status).toBe(404);
  });

  it('streams a real session run on the plain runtime', async () => {
    const stores = createMockStoresApp({ fixtures: await loadFixtures() });
    const { app, post } = server(async ({ sessionId, mandate, log }) => {
      const runtime = createPlainRuntime<PrickleEvent, SessionState>({
        sessionId,
        state: { mandate, verdicts: [] },
        log,
        // Every model call fails: the session must still start, report and end.
        driver: () => Promise.reject(new Error('no model in tests')),
      });
      await runSession({
        runtime,
        client: { baseUrl: 'http://stores.test', fetch: async (u, i) => stores.request(u, i) },
        wallet: createMockWallet(usdcUnits(600_000_000)),
        clock: () => new Date(at),
      });
    });
    const { sessionId } = (await (await post(JSON.stringify(fixtures.mandate))).json()) as {
      sessionId: string;
    };
    const got = await messages(await app.request(`/api/sessions/${sessionId}/events`));
    const types = got.map((m) => PrickleEvent.parse(m.data).type);
    expect(types[0]).toBe('session.started');
    expect(types.filter((t) => t === 'scout.started')).toHaveLength(5);
    expect(types.at(-1)).toBe('session.ended');
  });
});
