import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { createLiveRuntime, loadLiveEnv, newSessionId } from '@app/live-runtime';
import { parseRunLog } from '@app/report/concurrency';
import { runSession } from '@app/run-session';
import { toUsdcUnits } from '@core/money';
import { selectWallet } from '@payments/select-wallet';
import { createJsonlRunLog } from '@runtime/run-log';
import { startMockStores } from '../../mock-stores/serve';
import { createSessionApp } from './app';
import { createReplayRunner } from './replay';
import { createSessionHub, type SessionRunner } from './session-hub';

// The session server the frontend talks to, on PORT (default 8787).
//
//   pnpm dev                              live: each POSTed mandate runs as one session on
//                                         Mozaik with the mock stores in-process, one at a time;
//                                         every run log is written to runs/<session>.jsonl
//   pnpm dev:replay                       replay: streams runs/sample-run.jsonl instead (no
//     (or --replay <run log>)             model, no LLM key needed); labelled "replay"
//   STATIC_DIR=../frontend/dist           also serves the built page, so one process on one
//                                         port is the whole app (see docs/deploy.md)
//   REPLAY_SPEED=4  ALLOWED_ORIGINS=https://prickle.example.com,…

const { values } = parseArgs({ options: { replay: { type: 'string' } }, allowPositionals: true });
const Settings = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default('127.0.0.1'),
  REPLAY_RUN_LOG: z.string().min(1).optional(),
  REPLAY_SPEED: z.coerce.number().positive().default(4),
  STATIC_DIR: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z.string().default(''),
});
const settings = Settings.parse(process.env);
const replayLog = values.replay ?? settings.REPLAY_RUN_LOG;

async function liveRunner(): Promise<SessionRunner> {
  const loaded = loadLiveEnv();
  if (!loaded.ok) {
    console.error(`${loaded.message}\nOr run without a model: pnpm dev:replay`);
    process.exit(1);
  }
  const { env } = loaded;
  const stores = await startMockStores();
  console.log(
    `Live mode: models ${env.MODEL_FAST} / ${env.MODEL_STRONG}, stores ${stores.baseUrl}`,
  );
  return async ({ sessionId, mandate, log }) => {
    const wallet = await selectWallet(process.env, toUsdcUnits(mandate.maxTotal));
    const runtime = createLiveRuntime(env, { sessionId, mandate, log });
    console.log(`session ${sessionId}: ${mandate.description}, ${wallet.kind} wallet`);
    const result = await runSession({
      runtime,
      client: { baseUrl: stores.baseUrl, fetch },
      wallet,
      clock: () => new Date(),
    });
    console.log(`session ${sessionId}: ${result.outcome.kind}`);
  };
}

function replayRunner(path: string): SessionRunner {
  const lines = parseRunLog(readFileSync(path, 'utf8'));
  if (lines.length === 0) {
    console.error(`${path} holds no run-log lines.`);
    process.exit(1);
  }
  console.log(
    `Replay mode: ${path} (${lines.length} lines) at ${settings.REPLAY_SPEED}x; no model is called.`,
  );
  return createReplayRunner({ lines, speed: settings.REPLAY_SPEED });
}

const mode = replayLog ? 'replay' : 'live';
const hub = createSessionHub({
  newSessionId: () => newSessionId(mode === 'replay' ? 'replay' : 'web'),
  ...(mode === 'live' ? { archive: (id: string) => createJsonlRunLog(`runs/${id}.jsonl`) } : {}),
  onError: (sessionId, error) => console.error(`session ${sessionId} failed:`, error),
  run: replayLog ? replayRunner(replayLog) : await liveRunner(),
});

const origins = settings.ALLOWED_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const app = createSessionApp(hub, { mode, origins });
if (settings.STATIC_DIR) {
  // Registered after the API, so /api/* is answered first and everything else is the page.
  app.use('/*', serveStatic({ root: settings.STATIC_DIR }));
  console.log(`Serving the page from ${settings.STATIC_DIR}`);
}

serve({ fetch: app.fetch, port: settings.PORT, hostname: settings.HOST }, (info) => {
  console.log(
    `Prickle session server on http://${settings.HOST}:${info.port} (${mode}). Not financial advice.`,
  );
});
