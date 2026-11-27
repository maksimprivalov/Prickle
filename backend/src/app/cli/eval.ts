import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { formatEvent } from '@app/cli/terminal';
import { evalReport, formatEvalReport } from '@app/eval/eval-report';
import { runEval } from '@app/eval/run-eval';
import { scriptedModel } from '@app/eval/scripted-model';
import { createGroundingCheck } from '@app/grounding-check';
import { LlmEnv, llmRuntimeOptions } from '@app/llm-config';
import type { SessionState } from '@app/run-session';
import { NOT_FINANCIAL_ADVICE } from '@core/disclaimer/disclaimer';
import type { PrickleEvent } from '@core/events';
import { Mandate } from '@core/mandate';
import { toUsdcUnits } from '@core/money';
import { TrapEntry } from '@core/traps';
import { createMockWallet } from '@payments/mock-wallet';
import { createMozaikRuntime } from '@runtime/mozaik/mozaik-runtime';
import { createPlainRuntime } from '@runtime/plain/plain-runtime';
import type { Runtime } from '@runtime/port';
import { RunLogLine, createJsonlRunLog } from '@runtime/run-log';
import { startMockStores } from '../../mock-stores/serve';

// pnpm eval [--scripted] [--offers tv55] [--quiet]
//
// Every offer of every store through the deal verifier, merchant risk, the reviewer and the
// guard, then pay() asked to pay each one under the demo mandate. The tables are rebuilt from
// the run log afterwards, not from memory. Exits 1 if the mandate was exceeded, a trap offer
// was paid, or a planted trap was missed.
//
//   (default)     live: Mozaik + the LLM, as in pnpm demo. Slow on the free Gemini tier.
//   --scripted    plain runtime and a scripted stand-in for the LLM: no key, seconds.
//   --offers tv55 only the five demo TVs (a live run in a few minutes).
//   --quiet       no event stream, tables only.

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: fine for --scripted; a live run checks for a key below.
}

const args = process.argv.slice(2);
const scripted = args.includes('--scripted');
const quiet = args.includes('--quiet');
const offersArg = args[args.indexOf('--offers') + 1];
const onlyTv55 = args.includes('--offers') && offersArg === 'tv55';

const readFixture = <T>(file: string, schema: z.ZodType<T>): T =>
  schema.parse(
    JSON.parse(readFileSync(new URL(`../../../data/fixtures/${file}`, import.meta.url), 'utf8')),
  );

async function main(): Promise<number> {
  if (args.includes('--offers') && !onlyTv55) {
    console.error('--offers takes "tv55" (the five demo TVs).');
    return 2;
  }
  const mandate = readFixture('demo-mandate.json', Mandate);
  const key = readFixture('traps.json', z.array(TrapEntry));

  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').toLowerCase();
  const sessionId = `eval-${scripted ? 'scripted' : 'live'}-${stamp}`;
  const logPath = `runs/${sessionId}.jsonl`;
  const clock = () => new Date();
  const state: SessionState = { mandate, verdicts: [] };

  let runtime: Runtime<PrickleEvent, SessionState>;
  const checkOutput = () =>
    createGroundingCheck({ sessionId, mandate, clock, publish: (e) => runtime.publish(e) });
  let describe: string;
  if (scripted) {
    runtime = createPlainRuntime<PrickleEvent, SessionState>({
      sessionId,
      state,
      driver: scriptedModel,
      log: createJsonlRunLog(logPath),
      clock,
      checkOutput: checkOutput(),
    });
    describe = 'plain runtime, scripted model (no LLM)';
  } else {
    const env = LlmEnv.safeParse(process.env);
    if (!env.success) {
      console.error(env.error.issues.map((i) => i.message).join('\n'));
      console.error('Or run without an LLM: pnpm eval --scripted');
      return 1;
    }
    const llm = llmRuntimeOptions(env.data, process.env);
    runtime = createMozaikRuntime<PrickleEvent, SessionState>({
      sessionId,
      state,
      log: createJsonlRunLog(logPath),
      models: llm.models,
      agentModels: llm.agentModels,
      checkOutput: checkOutput(),
      // Forty offers at once wait long for free-tier request slots.
      loopTimeoutMs: 600_000,
      ...(llm.inference ? { inference: llm.inference } : {}),
    });
    describe = `Mozaik, ${llm.describe}`;
  }

  const startedAt = Date.now();
  if (!quiet) runtime.observe('*', (event) => console.log(formatEvent(event, startedAt)));
  console.log(`Prickle eval · ${describe}${onlyTv55 ? ' · demo TVs only' : ''}\n`);

  const stores = await startMockStores();
  try {
    const run = await runEval({
      runtime,
      client: { baseUrl: stores.baseUrl, fetch },
      wallet: createMockWallet(toUsdcUnits(mandate.maxTotal)),
      clock,
      ...(onlyTv55 ? { onlyOffers: (o) => o.offerId.endsWith('-tv55') } : {}),
    });
    if (run.failedStores.length > 0) {
      console.log(`\nStores that could not be read: ${run.failedStores.join(', ')}`);
    }
  } finally {
    await stores.close();
  }

  // The tables come from the log file, read back, as the README's numbers must.
  const lines = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => RunLogLine.parse(JSON.parse(line)));
  const report = evalReport(lines, key, onlyTv55 ? (id) => id.endsWith('-tv55') : undefined);
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`\n${formatEvalReport(report, logPath).join('\n')}`);
  console.log(`\nTook ${minutes} min. ${NOT_FINANCIAL_ADVICE}`);
  if (!report.ok) console.log('\nEVAL FAILED: see the tables above.');
  return report.ok ? 0 : 1;
}

process.exitCode = await main();
