import { readFileSync } from 'node:fs';
import { formatEvent } from '@app/cli/terminal';
import { createGroundingCheck } from '@app/grounding-check';
import { spendReport } from '@app/cli/spend-report';
import { LlmEnv, llmRuntimeOptions } from '@app/llm-config';
import { runSession, type SessionState } from '@app/run-session';
import type { PrickleEvent } from '@core/events';
import { Mandate } from '@core/mandate';
import { toUsdcUnits } from '@core/money';
import { selectWallet } from '@payments/select-wallet';
import { createMozaikRuntime } from '@runtime/mozaik/mozaik-runtime';
import { createJsonlRunLog } from '@runtime/run-log';
import { startMockStores } from '../../mock-stores/serve';

// pnpm demo [mandate JSON]: judge mode. One mandate end to end on synthetic stores, on Mozaik,
// with the mock wallet unless PAYMENTS=devnet. Needs one LLM key in backend/.env.
// Writes the run log to runs/<session>.jsonl.

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: the key may already be in the environment; checked below.
}

async function main(): Promise<number> {
  const parsedEnv = LlmEnv.safeParse(process.env);
  if (!parsedEnv.success) {
    console.error(parsedEnv.error.issues.map((i) => i.message).join('\n'));
    return 1;
  }
  const env = parsedEnv.data;
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const mandate = Mandate.parse(
    JSON.parse(
      arg ??
        readFileSync(new URL('../../../data/fixtures/demo-mandate.json', import.meta.url), 'utf8'),
    ),
  );

  const wallet = await selectWallet(process.env, toUsdcUnits(mandate.maxTotal));
  const stores = await startMockStores();
  const sessionId = `demo-${new Date().toISOString().replaceAll(/[:.]/g, '-').toLowerCase()}`;
  const logPath = `runs/${sessionId}.jsonl`;
  const llm = llmRuntimeOptions(env, process.env);
  const runtime = createMozaikRuntime<PrickleEvent, SessionState>({
    sessionId,
    state: { mandate, verdicts: [] },
    log: createJsonlRunLog(logPath),
    models: llm.models,
    agentModels: llm.agentModels,
    // Fix 1: answers with a number no cited record holds are dropped before anyone sees them.
    checkOutput: createGroundingCheck({
      sessionId,
      mandate,
      clock: () => new Date(),
      publish: (event) => runtime.publish(event),
    }),
    // Generous, because a loop may wait for a free request slot under the free-tier limit.
    loopTimeoutMs: 180_000,
    // Gemini thought-signature fix, per-model free-tier limits, one or more keys (llm-config.ts).
    ...(llm.inference ? { inference: llm.inference } : {}),
  });

  const startedAt = Date.now();
  runtime.observe('*', (event) => console.log(formatEvent(event, startedAt)));
  console.log(`Prickle demo · ${wallet.kind} wallet · ${llm.describe}\n`);

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
