import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentSpec, LoopResult, Runtime, ToolInterceptor } from '../port';
import { ModelTier, defineAgent, defineTool } from '../port';
import { RunLogLine, createMemoryRunLog } from '../run-log';
import type { ModelDriver } from './plain-runtime';
import { createPlainRuntime } from './plain-runtime';

// Test-only events. The real ones are the zod contracts in core/events.
type TestEvent =
  | { type: 'offer.found'; offerId: string }
  | { type: 'verdict.ready'; offerId: string; verdict: string };

const answer = z.object({ text: z.string() });

const agent = (name: string, tools: AgentSpec['tools'] = []) =>
  defineAgent({ name, prompt: `${name}.md`, model: ModelTier.Fast, tools, output: answer });

const fixedClock = () => new Date('2026-11-26T12:00:00.000Z');

function setup(
  driver: ModelDriver,
  checkOutput?: Parameters<typeof createPlainRuntime>[0]['checkOutput'],
) {
  const log = createMemoryRunLog();
  const runtime: Runtime<TestEvent, { spent: number }> = createPlainRuntime<
    TestEvent,
    { spent: number }
  >({
    sessionId: 's-1',
    state: { spent: 0 },
    driver,
    log,
    clock: fixedClock,
    ...(checkOutput ? { checkOutput } : {}),
  });
  return { runtime, log };
}

const ok = <O>(result: LoopResult<O>) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
  return result.output;
};

describe('plain runtime: loops', () => {
  it('runs five scout loops at the same time, not one after another', async () => {
    // Each driver waits until all five have started. Sequential loops would never get there.
    let started = 0;
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => (release = resolve));
    const { runtime, log } = setup(async ({ agent: a }) => {
      started += 1;
      if (started === 5) release();
      await allStarted;
      return { text: `${a.name} done` };
    });

    const handles = ['a', 'b', 'c', 'd', 'e'].map((s) => runtime.start(agent(`scout-${s}`), 'go'));
    const results = await Promise.all(handles.map((h) => h.done));

    expect(results.map((r) => ok(r).text)).toEqual([
      'scout-a done',
      'scout-b done',
      'scout-c done',
      'scout-d done',
      'scout-e done',
    ]);
    const kinds = log.lines().map((l) => l.kind);
    expect(kinds.lastIndexOf('loop.started')).toBeLessThan(kinds.indexOf('loop.finished'));
  });

  it('gives each loop its own id, also for two loops of the same agent', () => {
    const { runtime } = setup(() => Promise.resolve({ text: 'x' }));
    const verifier = agent('deal-verifier');
    expect(runtime.start(verifier, 'one').loopId).toBe('deal-verifier#1');
    expect(runtime.start(verifier, 'two').loopId).toBe('deal-verifier#2');
  });

  it('drops an answer that does not match the output schema', async () => {
    const { runtime, log } = setup(() => Promise.resolve({ text: 42 }));
    const result = await runtime.start(agent('scout-a'), 'go').done;
    expect(result).toMatchObject({ ok: false, reason: 'invalid_output' });
    expect(log.lines().at(-1)).toMatchObject({ kind: 'loop.finished', outcome: 'invalid_output' });
  });

  it('turns a throwing model into a failed result; done never rejects', async () => {
    const { runtime } = setup(() => Promise.reject(new Error('model down')));
    const result = await runtime.start(agent('scout-a'), 'go').done;
    expect(result).toEqual({ ok: false, reason: 'failed', detail: 'model down' });
  });

  it('rejects an output the output check refuses, and fails closed when the check throws', async () => {
    const refuse = setup(
      () => Promise.resolve({ text: 'was 649' }),
      () => ({ ok: false, detail: '649 has no record' }),
    );
    expect(await refuse.runtime.start(agent('reviewer'), 'go').done).toEqual({
      ok: false,
      reason: 'rejected',
      detail: '649 has no record',
    });

    const broken = setup(
      () => Promise.resolve({ text: 'x' }),
      () => {
        throw new Error('bug');
      },
    );
    expect(await broken.runtime.start(agent('reviewer'), 'go').done).toMatchObject({
      ok: false,
      reason: 'rejected',
    });
  });
});

describe('plain runtime: events and reactions', () => {
  it('starts the reacting agent on each event and lets it publish its verdict', async () => {
    const { runtime } = setup(({ message }) => Promise.resolve({ text: `checked ${message}` }));
    const verdicts: TestEvent[] = [];
    runtime.observe('verdict.ready', (e) => verdicts.push(e));

    runtime.react(agent('deal-verifier'), 'offer.found', {
      message: (e) => e.offerId,
      done: (result, e) => {
        runtime.publish({ type: 'verdict.ready', offerId: e.offerId, verdict: ok(result).text });
      },
    });

    runtime.publish({ type: 'offer.found', offerId: 'b-tv55' });
    runtime.publish({ type: 'offer.found', offerId: 'c-tv55' });
    await runtime.idle();

    expect(verdicts).toEqual([
      { type: 'verdict.ready', offerId: 'b-tv55', verdict: 'checked b-tv55' },
      { type: 'verdict.ready', offerId: 'c-tv55', verdict: 'checked c-tv55' },
    ]);
  });

  it('skips an event when the reaction returns no message', async () => {
    const driver = vi.fn(() => Promise.resolve({ text: 'x' }));
    const { runtime } = setup(driver);
    runtime.react(agent('deal-verifier'), 'offer.found', {
      message: () => undefined,
      done: () => undefined,
    });
    runtime.publish({ type: 'offer.found', offerId: 'a-tv55' });
    await runtime.idle();
    expect(driver).not.toHaveBeenCalled();
  });

  it('keeps delivering to other listeners when one throws, and logs the failure', () => {
    const { runtime, log } = setup(() => Promise.resolve({ text: 'x' }));
    const seen: string[] = [];
    runtime.observe('*', () => {
      throw new Error('broken observer');
    });
    runtime.observe('*', (e) => seen.push(e.type));
    runtime.publish({ type: 'offer.found', offerId: 'a-tv55' });
    expect(seen).toEqual(['offer.found']);
    expect(log.lines().map((l) => l.kind)).toEqual(['event', 'handler.failed']);
  });
});

describe('plain runtime: tools and interception', () => {
  // A standalone mock, so the assertions do not pull the method off the tool object.
  const payRun = vi.fn(() => Promise.resolve({ signature: 'mock-1' }));
  const pay = defineTool({
    name: 'pay',
    description: 'Pays a store from the session wallet.',
    input: z.object({ storeId: z.string(), amountCents: z.int() }),
    output: z.object({ signature: z.string() }),
    run: payRun,
  });

  const payingDriver: ModelDriver = async ({ callTool }) => {
    const result = await callTool('pay', { storeId: 'd', amountCents: 64800 });
    return { text: JSON.stringify(result) };
  };

  const denyOver = (maxCents: number): ToolInterceptor => ({
    name: 'mandate-guard',
    matches: (call) => call.tool === 'pay',
    decide: (call) => {
      const { amountCents } = z.object({ amountCents: z.int() }).parse(call.input);
      return Promise.resolve(
        amountCents <= maxCents
          ? { allow: true }
          : { allow: false, reason: `${amountCents} > ${maxCents}` },
      );
    },
  });

  it('blocks a payment above the mandate before the tool runs', async () => {
    payRun.mockClear();
    const { runtime, log } = setup(payingDriver);
    runtime.intercept(denyOver(60000));

    const result = await runtime.start(agent('budget', [pay]), 'pay store D').done;

    expect(payRun).not.toHaveBeenCalled();
    expect(JSON.parse(ok(result).text)).toEqual({ blocked: true, reason: '64800 > 60000' });
    expect(log.lines()).toContainEqual(
      expect.objectContaining({ kind: 'tool.blocked', tool: 'pay', interceptor: 'mandate-guard' }),
    );
  });

  it('lets a payment inside the mandate through', async () => {
    payRun.mockClear();
    const { runtime } = setup(payingDriver);
    runtime.intercept(denyOver(70000));
    const result = await runtime.start(agent('budget', [pay]), 'pay').done;
    expect(payRun).toHaveBeenCalledOnce();
    expect(JSON.parse(ok(result).text)).toEqual({ signature: 'mock-1' });
  });

  it('blocks the call when an interceptor throws (fails closed)', async () => {
    payRun.mockClear();
    const { runtime } = setup(payingDriver);
    runtime.intercept({
      name: 'mandate-guard',
      matches: () => true,
      decide: () => Promise.reject(new Error('mandate missing')),
    });
    const result = await runtime.start(agent('budget', [pay]), 'pay').done;
    expect(payRun).not.toHaveBeenCalled();
    expect(JSON.parse(ok(result).text)).toMatchObject({ blocked: true });
  });

  it('refuses invalid tool input without running the tool', async () => {
    payRun.mockClear();
    const { runtime } = setup(async ({ callTool }) => ({
      text: JSON.stringify(await callTool('pay', { storeId: 'd', amountCents: 648.5 })),
    }));
    const result = await runtime.start(agent('budget', [pay]), 'pay').done;
    expect(payRun).not.toHaveBeenCalled();
    expect(ok(result).text).toContain('invalid input for pay');
  });

  it('collects the records tools register, for the grounding check', async () => {
    const priceHistory = defineTool({
      name: 'price_history',
      description: 'Daily prices for one offer.',
      input: z.object({ offerId: z.string() }),
      output: z.object({ rows: z.array(z.object({ recordId: z.string(), cents: z.int() })) }),
      run: (input, ctx) => {
        const rows = [{ recordId: `${input.offerId}-ph-1`, cents: 69900 }];
        ctx.records.add(rows);
        return Promise.resolve({ rows });
      },
    });
    const { runtime } = setup(async ({ callTool }) => {
      await callTool('price_history', { offerId: 'b-tv55' });
      return { text: 'ok' };
    });
    await runtime.start(agent('deal-verifier', [priceHistory]), 'check').done;
    expect(runtime.records.get('b-tv55-ph-1')).toEqual({ recordId: 'b-tv55-ph-1', cents: 69900 });
  });
});

describe('plain runtime: run log', () => {
  it('writes lines that parse with the run-log schema, in order', async () => {
    const { runtime, log } = setup(() => Promise.resolve({ text: 'x' }));
    runtime.publish({ type: 'offer.found', offerId: 'a-tv55' });
    await runtime.start(agent('scout-a'), 'go').done;

    const lines = log.lines();
    for (const line of lines) expect(RunLogLine.safeParse(line).success).toBe(true);
    expect(lines.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(lines[0]).toEqual({
      kind: 'event',
      seq: 0,
      at: '2026-11-26T12:00:00.000Z',
      sessionId: 's-1',
      event: { type: 'offer.found', offerId: 'a-tv55' },
    });
  });
});
