import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createLiveRuntime, loadLiveEnv, newSessionId } from '@app/live-runtime';
import { runSession } from '@app/run-session';
import { toUsdcUnits } from '@core/money';
import { selectWallet } from '@payments/select-wallet';
import { createJsonlRunLog } from '@runtime/run-log';
import { startMockStores } from '../../mock-stores/serve';
import { createSessionApp } from './app';
import { createSessionHub } from './session-hub';

// pnpm dev: the session server the frontend talks to, on PORT (default 8787), with the mock
// stores in-process. Each POSTed mandate runs as one live session on Mozaik, one at a time.
// Every session's run log is also written to runs/<session>.jsonl.

const loaded = loadLiveEnv();
if (!loaded.ok) {
  console.error(loaded.message);
  process.exit(1);
}
const { env } = loaded;
const port = z.coerce.number().int().min(1).max(65535).default(8787).parse(process.env.PORT);

const stores = await startMockStores();
const hub = createSessionHub({
  newSessionId: () => newSessionId('web'),
  archive: (sessionId) => createJsonlRunLog(`runs/${sessionId}.jsonl`),
  onError: (sessionId, error) => console.error(`session ${sessionId} failed:`, error),
  run: async ({ sessionId, mandate, log }) => {
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
  },
});

serve({ fetch: createSessionApp(hub).fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(
    `Prickle session server on http://127.0.0.1:${info.port} (mock stores ${stores.baseUrl})`,
  );
  console.log(`Models ${env.MODEL_FAST} / ${env.MODEL_STRONG}. Not financial advice.`);
});
