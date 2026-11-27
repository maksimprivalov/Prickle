import { describe, expect, it } from 'vitest';
import { fixtures } from '@test/fixtures';
import type { PrickleEvent } from '@core/events';
import { cents, toUsdcUnits } from '@core/money';
import { createMockWallet } from '@payments/mock-wallet';
import { createPlainRuntime, type ModelDriver } from '@runtime/plain/plain-runtime';
import { createMemoryRunLog } from '@runtime/run-log';
import { createMockStoresApp } from '../../mock-stores/app';
import { loadFixtures } from '../../mock-stores/fixtures';
import { createGroundingCheck } from '../grounding-check';
import type { SessionState } from '../run-session';
import { evalReport } from './eval-report';
import { runEval } from './run-eval';
import { scriptedModel } from './scripted-model';

// pnpm eval --scripted end to end, in process: real mock stores, real tools, the real checkers,
// reviewer, grounding check and guard; the scripted stand-in instead of the LLM.

async function evaluate(driver: ModelDriver, onlyTv55 = false, downStore?: string) {
  const app = createMockStoresApp({ fixtures: await loadFixtures() });
  const log = createMemoryRunLog();
  const clock = () => new Date('2026-11-27T12:00:00.000Z');
  const runtime = createPlainRuntime<PrickleEvent, SessionState>({
    sessionId: 'eval-test',
    state: { mandate: fixtures.mandate, verdicts: [] },
    driver,
    log,
    clock,
    checkOutput: createGroundingCheck({
      sessionId: 'eval-test',
      mandate: fixtures.mandate,
      clock,
      publish: (event) => runtime.publish(event),
    }),
  });
  await runEval({
    runtime,
    client: {
      baseUrl: 'http://stores.test',
      fetch: async (url, init) =>
        downStore !== undefined && String(url).includes(`/stores/${downStore}/`)
          ? new Response('down', { status: 503 })
          : app.request(url, init),
    },
    wallet: createMockWallet(toUsdcUnits(fixtures.mandate.maxTotal)),
    clock,
    ...(onlyTv55 ? { onlyOffers: (o) => o.offerId.endsWith('-tv55') } : {}),
  });
  return evalReport(
    log.lines(),
    fixtures.traps,
    onlyTv55 ? (id) => id.endsWith('-tv55') : undefined,
  );
}

describe('pnpm eval (scripted)', () => {
  it('checks every offer and catches every planted trap', async () => {
    const report = await evaluate(scriptedModel);
    expect(report.offers).toBe(fixtures.offers.length);
    const missed = report.traps
      .filter((t) => !t.caught)
      .map((t) => `${t.trap.trap} ${t.trap.offerId}`);
    expect(missed).toEqual([]);
    expect(report.traps).toHaveLength(fixtures.traps.length);
  });

  it('rejects no honest offer', async () => {
    const report = await evaluate(scriptedModel);
    expect(report.honest.total).toBeGreaterThan(0);
    expect(report.honest.wronglyRejected).toEqual([]);
  });

  it('pays only the demo deal when asked to pay every offer, and never exceeds the mandate', async () => {
    const report = await evaluate(scriptedModel);
    expect(report.spend.paid).toEqual([{ offerId: 'b-tv55', amount: toUsdcUnits(cents(58_500)) }]);
    expect(report.spend.exceeded).toBe(false);
    expect(report.trapsPaid).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('still catches every trap when the model fails on every call (the code decides)', async () => {
    const report = await evaluate(() => Promise.reject(new Error('429 quota exceeded')));
    // The deal verifier needs the model to fetch the history: without it, discounts cannot be
    // verified, so fake ones are not proven fake. Every other trap is still caught.
    const missed = report.traps.filter((t) => !t.caught).map((t) => t.trap.trap);
    expect(new Set(missed)).toEqual(new Set(['fake_discount']));
    expect(report.spend.exceeded).toBe(false);
    expect(report.trapsPaid).toEqual([]);
  });

  it('fails when a store cannot be read, instead of passing on fewer traps', async () => {
    const report = await evaluate(scriptedModel, false, 'c');
    const missed = report.traps.filter((t) => !t.caught).map((t) => t.trap.offerId);
    expect(missed.sort()).toEqual(['c-laptop', 'c-soundbar', 'c-tv55']);
    expect(report.ok).toBe(false);
  });

  it('limits the run to the demo TVs when asked', async () => {
    const report = await evaluate(scriptedModel, true);
    expect(report.offers).toBe(5);
    expect(report.traps.every((t) => t.trap.offerId.endsWith('-tv55'))).toBe(true);
  });
});
