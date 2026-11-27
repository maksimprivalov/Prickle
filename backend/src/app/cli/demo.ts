import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { formatEvent } from '@app/cli/terminal';
import { spendReport } from '@app/cli/spend-report';
import { runSession, type SessionState } from '@app/run-session';
import type { PrickleEvent } from '@core/events';
import { Mandate } from '@core/mandate';
import { toUsdcUnits } from '@core/money';
import { selectWallet } from '@payments/select-wallet';
import { createGeminiSafeRunner } from '@runtime/mozaik/gemini-thought-signatures';
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

const Env = z
  .object({
    GEMINI_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // gemini-3.5-flash was overloaded (503) on every run on 26 Nov; the lite model was not.
    MODEL_FAST: z.string().min(1).default('gemini-3.5-flash-lite'),
    MODEL_STRONG: z.string().min(1).default('gemini-3.5-flash-lite'),
    // Gemini's free tier allows 15 requests per minute per model; stay just under it. 0 = no limit.
    GEMINI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(0).default(14),
  })
  .refine((env) => env.GEMINI_API_KEY ?? env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY, {
    message: 'No LLM key: put GEMINI_API_KEY=... in backend/.env (see .env.example).',
  });

async function main(): Promise<number> {
  const parsedEnv = Env.safeParse(process.env);
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
  const usesGemini = [env.MODEL_FAST, env.MODEL_STRONG].some((m) => m.startsWith('gemini'));
  const runtime = createMozaikRuntime<PrickleEvent, SessionState>({
    sessionId,
    state: { mandate, verdicts: [] },
    log: createJsonlRunLog(logPath),
    models: { fast: env.MODEL_FAST, strong: env.MODEL_STRONG },
    // Generous, because a loop may wait for a free request slot under the free-tier limit.
    loopTimeoutMs: 180_000,
    // Keeps Gemini's thought signatures, which Mozaik 6.0.0 drops (docs/mozaik-findings.md).
    ...(usesGemini
      ? { inference: createGeminiSafeRunner({ requestsPerMinute: env.GEMINI_REQUESTS_PER_MINUTE }) }
      : {}),
  });

  const startedAt = Date.now();
  runtime.observe('*', (event) => console.log(formatEvent(event, startedAt)));
  console.log(
    `Prickle demo · ${wallet.kind} wallet · models ${env.MODEL_FAST} / ${env.MODEL_STRONG}\n`,
  );

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
