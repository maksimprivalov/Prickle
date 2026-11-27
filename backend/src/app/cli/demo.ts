import { readFileSync } from 'node:fs';
import { formatEvent } from '@app/cli/terminal';
import { spendReport } from '@app/cli/spend-report';
import { createLiveRuntime, describeLive, loadLiveEnv, newSessionId } from '@app/live-runtime';
import { runSession } from '@app/run-session';
import { Mandate } from '@core/mandate';
import { toUsdcUnits } from '@core/money';
import { selectWallet } from '@payments/select-wallet';
import { createJsonlRunLog } from '@runtime/run-log';
import { startMockStores } from '../../mock-stores/serve';

// pnpm demo [mandate JSON]: judge mode. One mandate end to end on synthetic stores, on Mozaik,
// with the mock wallet unless PAYMENTS=devnet. Needs one LLM key in backend/.env.
// Writes the run log to runs/<session>.jsonl.

async function main(): Promise<number> {
  const loaded = loadLiveEnv();
  if (!loaded.ok) {
    console.error(loaded.message);
    return 1;
  }
  const { env } = loaded;
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const mandate = Mandate.parse(
    JSON.parse(
      arg ??
        readFileSync(new URL('../../../data/fixtures/demo-mandate.json', import.meta.url), 'utf8'),
    ),
  );

  const wallet = await selectWallet(process.env, toUsdcUnits(mandate.maxTotal));
  const stores = await startMockStores();
  const sessionId = newSessionId('demo');
  const logPath = `runs/${sessionId}.jsonl`;
  const runtime = createLiveRuntime(env, { sessionId, mandate, log: createJsonlRunLog(logPath) });

  const startedAt = Date.now();
  runtime.observe('*', (event) => console.log(formatEvent(event, startedAt)));
  console.log(`Prickle demo · ${wallet.kind} wallet · ${describeLive(env)}\n`);

  try {
    const result = await runSession({
      runtime,
      client: { baseUrl: stores.baseUrl, fetch },
      wallet,
      clock: () => new Date(),
    });
    console.log('');
    for (const line of spendReport({
      mandate,
      entries: result.ledger.entries(),
      spent: result.ledger.spent().amount,
      wallet: wallet.kind,
      outcome: result.outcome,
    })) {
      console.log(line);
    }
    console.log(`\nRun log: ${logPath}`);
    return result.outcome.kind === 'failed' ? 1 : 0;
  } finally {
    await stores.close();
  }
}

// Exit explicitly: a loop that was stopped can still have a model request in flight, which
// would otherwise keep the process (and its Gemini quota use) alive after the report.
process.exit(await main());
