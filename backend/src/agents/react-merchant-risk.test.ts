import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EventName, PrickleEvent, type VerdictReady } from '@core/events';
import { Mandate } from '@core/mandate';
import { Offer } from '@core/offers';
import type { Verdict } from '@core/verdicts';
import type { StoreClient } from '@tools/index';
import { createPlainRuntime, type ModelDriver } from '@runtime/plain/plain-runtime';
import { createMemoryRunLog } from '@runtime/run-log';
import { createMockStoresApp } from '../mock-stores/app';
import { loadFixtures } from '../mock-stores/fixtures';
import { reactMerchantRisk, type MerchantRiskNotice } from './react-merchant-risk';
import { startScouts } from './start-scouts';

// Scouts and merchant risk together on the plain adapter: real mock stores and tools, a
// scripted stand-in for the model. No LLM and no network.

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

const RecordIdOf = z.object({ recordId: z.string() });
const Answer = z.object({
  checkout: RecordIdOf.optional(),
  store: RecordIdOf.optional(),
  offers: z.array(RecordIdOf).optional(),
});
const offerIn = (message: string): Offer => {
  const json = message.split('\n')[0]?.replace(/^Offer: /, '') ?? '';
  return Offer.parse(JSON.parse(json));
};

/** A diligent checker: calls all three tools and names what came back; explains nothing. */
const diligentRisk: ModelDriver = async ({ message, callTool }) => {
  const { storeId, offerId } = offerIn(message);
  const checkout = Answer.parse(await callTool('checkout_total', { storeId, offerId })).checkout;
  const store = Answer.parse(await callTool('store_profile', { storeId })).store;
  const offers = Answer.parse(await callTool('store_catalog', { storeId })).offers ?? [];
  return {
    checkout: checkout?.recordId ?? 'missing',
    store: store?.recordId ?? 'missing',
    storeOffers: offers.map((o) => o.recordId),
    explanations: [],
  };
};

const honestScout: ModelDriver = async ({ callTool }) => {
  const result = z
    .object({ offers: z.array(RecordIdOf).default([]) })
    .parse(await callTool('search_catalog', { category: 'tv', screenInches: 55 }));
  return { matches: result.offers.map((o) => o.recordId), note: 'Searched TVs at 55 inches.' };
};

async function run(risk: ModelDriver, riskClient?: StoreClient) {
  const runtime = createPlainRuntime<PrickleEvent, object>({
    sessionId: 's-test',
    state: {},
    driver: (request) =>
      request.agent.name === 'merchant-risk' ? risk(request) : honestScout(request),
    log: createMemoryRunLog(),
  });
  const events: PrickleEvent[] = [];
  const notices: MerchantRiskNotice[] = [];
  runtime.observe('*', (event) => events.push(PrickleEvent.parse(event)));
  const clock = () => new Date('2026-11-27T09:00:00.000Z');
  const handler = reactMerchantRisk(runtime, {
    client: riskClient ?? client,
    clock,
    onNotice: (n) => notices.push(n),
  });
  await startScouts(runtime, { mandate, client, clock });
  await runtime.idle();
  await handler.settled();
  const verdicts = new Map(
    events
      .filter((e): e is VerdictReady => e.type === EventName.VerdictReady)
      .map((e) => [e.verdict.offerId, e.verdict]),
  );
  return { verdicts, notices };
}

/** Stands in for a model call that fails, e.g. a 429 from the free LLM tier. */
const failing: ModelDriver = () => Promise.reject(new Error('429 quota exceeded'));

/** Offer → decision and reason codes, sorted: verdicts arrive in no fixed order. */
const summary = (verdicts: ReadonlyMap<string, Verdict>) =>
  [...verdicts.values()]
    .map((v) => `${v.offerId} ${v.decision} ${v.reasons.map((r) => r.code).join(',')}`)
    .sort();

describe('reactMerchantRisk', () => {
  it('publishes one merchant-risk verdict per offer found, decided by code', async () => {
    const { verdicts, notices } = await run(diligentRisk);
    expect(notices).toEqual([]);
    expect([...verdicts.keys()].sort()).toEqual(['a-tv55', 'b-tv55', 'c-tv55', 'd-tv55', 'e-tv55']);
    const codes = (offerId: string) => verdicts.get(offerId)?.reasons.map((r) => r.code);
    expect(verdicts.get('b-tv55')).toMatchObject({ checker: 'merchant-risk', decision: 'pass' });
    expect(codes('d-tv55')).toEqual(['hidden_fee']);
    expect(codes('e-tv55')).toEqual(['fake_scarcity', 'no_refund_policy', 'untrusted_store']);
  });

  it('ignores an agent answer naming a checkout no tool returned, and decides from the tools', async () => {
    const lazy: ModelDriver = async (request) => {
      const answer = z
        .object({ store: z.string() })
        .loose()
        .parse(await diligentRisk(request));
      return { ...answer, checkout: 'x-made-up-co-1' };
    };
    const { verdicts, notices } = await run(lazy);
    expect(notices.filter((n) => n.kind === 'fallback')).toHaveLength(5);
    expect(verdicts.get('d-tv55')?.reasons.map((r) => r.code)).toEqual(['hidden_fee']);
  });

  it('still decides every offer when the model call fails (a 429), the same as when it works', async () => {
    const { verdicts, notices } = await run(failing);
    const { verdicts: expected } = await run(diligentRisk);
    expect(notices.map((n) => n.kind)).toEqual(Array(5).fill('fallback'));
    expect(summary(verdicts)).toEqual(summary(expected));
  });

  it('publishes no verdict when the store fails as well, so the guard denies', async () => {
    const down: StoreClient = {
      baseUrl: 'http://stores.test',
      fetch: () => Promise.resolve(new Response('down', { status: 503 })),
    };
    const { verdicts, notices } = await run(failing, down);
    expect(verdicts.size).toBe(0);
    expect(notices.filter((n) => n.kind === 'no_verdict')).toHaveLength(5);
  });
});
