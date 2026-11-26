import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EventName, PrickleEvent } from '@core/events';
import { Mandate } from '@core/mandate';
import type { StoreClient } from '@tools/index';
import { createPlainRuntime, type ModelDriver } from '@runtime/plain/plain-runtime';
import { createMemoryRunLog } from '@runtime/run-log';
import { createMockStoresApp } from '../mock-stores/app';
import { loadFixtures } from '../mock-stores/fixtures';
import { startScouts } from './start-scouts';

// The scout flow end to end on the plain adapter: real mock stores, real tools, and a scripted
// stand-in for the model. No LLM and no network.

const mandate = Mandate.parse({
  description: '55-inch TV',
  category: 'tv',
  screenInches: 55,
  maxTotal: 60_000,
  requireRealDiscount: true,
  trustedStoresOnly: true,
});

let client: StoreClient;
beforeAll(async () => {
  const app = createMockStoresApp({ fixtures: await loadFixtures() });
  client = { baseUrl: 'http://stores.test', fetch: async (url, init) => app.request(url, init) };
});

const CatalogAnswer = z.object({ offers: z.array(z.object({ recordId: z.string() })).default([]) });
const recordIdsOf = (output: unknown): string[] =>
  CatalogAnswer.parse(output).offers.map((o) => o.recordId);

/** A well-behaved scout: searches with the mandate's filters, names what came back. */
const honestScout: ModelDriver = async ({ callTool }) => {
  const result = await callTool('search_catalog', { category: 'tv', screenInches: 55 });
  return { matches: recordIdsOf(result), note: 'Searched TVs at 55 inches.' };
};

function run(driver: ModelDriver) {
  const log = createMemoryRunLog();
  const runtime = createPlainRuntime<PrickleEvent, object>({
    sessionId: 's-test',
    state: {},
    driver,
    log,
  });
  const events: PrickleEvent[] = [];
  runtime.observe('*', (event) => events.push(PrickleEvent.parse(event)));
  const clock = () => new Date('2026-11-27T09:00:00.000Z');
  return { runs: startScouts(runtime, { mandate, client, clock }), events, log };
}

describe('startScouts', () => {
  it('finds the one 55-inch TV in each of the five stores and publishes it as offer.found', async () => {
    const { runs, events } = run(honestScout);
    await runs;
    const found = events.filter((e) => e.type === EventName.OfferFound);
    expect(found.map((e) => e.offer.offerId).sort()).toEqual([
      'a-tv55',
      'b-tv55',
      'c-tv55',
      'd-tv55',
      'e-tv55',
    ]);
    const b = found.find((e) => e.offer.offerId === 'b-tv55');
    expect(b).toMatchObject({ agent: 'scout-b', offer: { price: 58_500, wasPrice: 69_900 } });
  });

  it('starts all five scouts before any of them finishes', async () => {
    const { runs, log } = run(honestScout);
    await runs;
    const kinds = log.lines().map((l) => l.kind);
    const lastStart = kinds.lastIndexOf('loop.started');
    const firstFinish = kinds.indexOf('loop.finished');
    expect(kinds.filter((k) => k === 'loop.started')).toHaveLength(5);
    expect(lastStart).toBeLessThan(firstFinish);
  });

  it('takes prices from the store record, so a scout cannot change them', async () => {
    const { runs, events } = run(async (request) => {
      await honestScout(request);
      // The model can only name ids; there is no field for a price to smuggle in.
      return { matches: [`${request.agent.name.slice(-1)}-tv55-of-1`], note: 'It was €1.' };
    });
    await runs;
    const c = events.find((e) => e.type === EventName.OfferFound && e.offer.offerId === 'c-tv55');
    expect(c).toMatchObject({ offer: { price: 59_900, wasPrice: 64_900 } });
  });

  it('drops invented, other-store and wrong-size offers instead of publishing them', async () => {
    const { runs, events } = run(async ({ agent, callTool }) => {
      await callTool('search_catalog', {});
      const store = agent.name.slice(-1);
      const other = store === 'a' ? 'b' : 'a';
      return {
        matches: [`${store}-tv99-of-1`, `${other}-tv55-of-1`, `${store}-tv65-of-1`],
        note: 'Bad answer on purpose.',
      };
    });
    const results = await runs;
    expect(events.some((e) => e.type === EventName.OfferFound)).toBe(false);
    for (const result of results) {
      const [invented, otherStore, wrongSize] = result.dropped.map((d) => d.reason);
      expect(invented).toBe('not_returned_by_a_tool');
      // Depends on whether the other store's scout searched first; dropped either way.
      expect(['not_returned_by_a_tool', 'from_another_store']).toContain(otherStore);
      expect(wrongSize).toBe('not_the_mandate_product');
    }
  });

  it('reports a scout whose answer is not a valid report as failed, and the others still finish', async () => {
    const { runs, events } = run(async (request) =>
      request.agent.name === 'scout-d' ? { nonsense: true } : honestScout(request),
    );
    const results = await runs;
    const finished = events.filter((e) => e.type === EventName.ScoutFinished);
    expect(finished).toHaveLength(5);
    expect(finished.find((e) => e.storeId === 'd')?.outcome.ok).toBe(false);
    expect(results.filter((r) => r.offers.length === 1)).toHaveLength(4);
  });
});
