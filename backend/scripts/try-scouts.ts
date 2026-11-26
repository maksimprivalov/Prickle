import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { startScouts } from '@agents/start-scouts';
import { formatEvent } from '@app/cli/terminal';
import { EventName, type PrickleEvent } from '@core/events';
import { Mandate } from '@core/mandate';
import { createGeminiSafeRunner } from '@runtime/mozaik/gemini-thought-signatures';
import { createMozaikRuntime } from '@runtime/mozaik/mozaik-runtime';
import { createJsonlRunLog } from '@runtime/run-log';
import { startMockStores } from '../src/mock-stores/serve';

// See the five scouts run for real, on Mozaik with a live model, before `pnpm demo` exists:
//
//   pnpm exec tsx scripts/try-scouts.ts                     the demo mandate (55-inch TV)
//   pnpm exec tsx scripts/try-scouts.ts '<mandate JSON>'    any other mandate
//   pnpm exec tsx scripts/try-scouts.ts --no-gemini-fix     reproduce the Mozaik 6.0.0 Gemini
//                                                           bug (docs/mozaik-findings.md)
//
// Needs an LLM key in backend/.env. Writes the run log to runs/<session>.jsonl.

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: the key may already be in the environment; checked below.
}

const Env = z
  .object({
    GEMINI_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // gemini-3.5-flash was overloaded (503) on every run on 26 Nov; the lite model was not.
    SCOUT_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  })
  .refine((env) => env.GEMINI_API_KEY ?? env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY, {
    message: 'No LLM key: put GEMINI_API_KEY=... in backend/.env (see .env.example).',
  });
const env = Env.parse(process.env);

const args = process.argv.slice(2);
const geminiFix = !args.includes('--no-gemini-fix');
const mandateArg = args.find((arg) => !arg.startsWith('--'));
const mandate = Mandate.parse(
  JSON.parse(
    mandateArg ??
      readFileSync(new URL('../data/fixtures/demo-mandate.json', import.meta.url), 'utf8'),
  ),
);
if (!geminiFix) console.log('Running WITHOUT the Gemini thought-signature fix.\n');

const stores = await startMockStores();
const sessionId = `try-scouts-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
const clock = () => new Date();
const runtime = createMozaikRuntime<PrickleEvent, { mandate: Mandate }>({
  sessionId,
  state: { mandate },
  log: createJsonlRunLog(`runs/${sessionId}.jsonl`),
  models: { fast: env.SCOUT_MODEL, strong: env.SCOUT_MODEL },
  loopTimeoutMs: 60_000,
  // Keeps Gemini's thought signatures, which Mozaik 6.0.0 drops (docs/mozaik-findings.md).
  ...(geminiFix ? { inference: createGeminiSafeRunner() } : {}),
});

const startedAt = Date.now();
runtime.observe('*', (event) => console.log(formatEvent(event, startedAt)));
runtime.publish({
  type: EventName.SessionStarted,
  sessionId,
  at: clock().toISOString(),
  agent: 'app',
  mandate,
});

const runs = await startScouts(runtime, {
  mandate,
  client: { baseUrl: stores.baseUrl, fetch },
  clock,
});
await stores.close();

console.log('\nScout answers:');
for (const run of runs) {
  const name = `scout-${run.storeId}`;
  if (!run.result.ok) {
    console.log(`  ${name}: failed (${run.result.reason}) ${run.result.detail}`);
    continue;
  }
  console.log(`  ${name}: ${run.result.output.note}`);
  for (const d of run.dropped) console.log(`    dropped ${d.recordId}: ${d.reason}`);
}
const found = runs.reduce((n, run) => n + run.offers.length, 0);
const failed = runs.filter((run) => !run.result.ok).length;
console.log(
  `\n${found} offers found, ${failed} of ${runs.length} scouts failed. Run log: runs/${sessionId}.jsonl`,
);
process.exitCode = failed > 0 ? 1 : 0;
