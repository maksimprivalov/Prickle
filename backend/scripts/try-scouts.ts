import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { reactMerchantRisk } from '@agents/react-merchant-risk';
import { startScouts } from '@agents/start-scouts';
import { formatEvent } from '@app/cli/terminal';
import { NOT_FINANCIAL_ADVICE } from '@core/disclaimer/disclaimer';
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
//   pnpm exec tsx scripts/try-scouts.ts --merchant-risk     also run merchant risk on each
//                                                           offer.found, as it appears
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
const withMerchantRisk = args.includes('--merchant-risk');
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

/** A 429 from Gemini is hundreds of characters of JSON; say what it means instead. */
const shortDetail = (detail: string): string =>
  detail.includes('"code":429')
    ? 'LLM quota exceeded (429): wait a minute and rerun'
    : detail.slice(0, 200);

// Per offer: the merchant-risk verdict, or why there is none. Printed at the end.
const riskOutcomes = new Map<string, string>();
runtime.observe(EventName.VerdictReady, (event) => {
  if (event.type !== EventName.VerdictReady || event.verdict.checker !== 'merchant-risk') return;
  const { offerId, decision, reasons } = event.verdict;
  riskOutcomes.set(
    offerId,
    [
      `${decision}: ${reasons.map((r) => r.code).join(', ')}`,
      ...reasons.map((r) => `      ${r.text}`),
    ].join('\n'),
  );
});

const client = { baseUrl: stores.baseUrl, fetch };
if (withMerchantRisk) {
  reactMerchantRisk(runtime, {
    client,
    clock,
    onNotice: (n) => {
      if (n.kind === 'no_verdict') {
        riskOutcomes.set(n.offerId, `no verdict: ${shortDetail(n.detail)}`);
      } else if (n.kind === 'fallback') {
        console.log(
          `  merchant-risk ${n.offerId}: decided without the model (${shortDetail(n.detail)})`,
        );
      } else {
        console.log(
          `  merchant-risk ${n.offerId}: model claimed ${n.codes.join(', ')}; code disagreed`,
        );
      }
    },
  });
}
const runs = await startScouts(runtime, { mandate, client, clock });
// Merchant-risk loops started by offer.found may still be running.
await runtime.idle();
await stores.close();

console.log('\nScout answers:');
for (const run of runs) {
  const name = `scout-${run.storeId}`;
  if (!run.result.ok) {
    console.log(`  ${name}: failed (${run.result.reason}) ${shortDetail(run.result.detail)}`);
    continue;
  }
  console.log(`  ${name}: ${run.result.output.note}`);
  for (const d of run.dropped) console.log(`    dropped ${d.recordId}: ${d.reason}`);
}
if (withMerchantRisk) {
  console.log('\nMerchant risk (is the store behind each offer safe?):');
  for (const offer of runs.flatMap((run) => run.offers)) {
    console.log(`  ${offer.offerId}: ${riskOutcomes.get(offer.offerId) ?? 'no verdict'}`);
  }
  console.log(`  ${NOT_FINANCIAL_ADVICE}`);
}
const found = runs.reduce((n, run) => n + run.offers.length, 0);
const failed = runs.filter((run) => !run.result.ok).length;
console.log(
  `\n${found} offers found, ${failed} of ${runs.length} scouts failed. Run log: runs/${sessionId}.jsonl`,
);
process.exitCode = failed > 0 ? 1 : 0;
