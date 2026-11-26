import {
  DeveloperMessageItem,
  FunctionCallItem,
  FunctionCallOutputItem,
  ModelMessageItem,
  type InferenceInput,
  type InferenceOutput,
  UserMessageItem,
  type InferenceRunner,
} from '@mozaik-ai/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentSpec, LoopResult, ToolInterceptor } from '../port';
import { ModelTier, defineAgent, defineTool } from '../port';
import { RunLogLine, createMemoryRunLog } from '../run-log';
import type { MozaikRuntimeConfig } from './mozaik-runtime';
import { createMozaikRuntime } from './mozaik-runtime';

// Real Mozaik loops (runLoop, situation handlers, interception) with a scripted model in place
// of the LLM, so no key and no network are needed.

type TestEvent =
  | { type: 'offer.found'; offerId: string }
  | { type: 'verdict.ready'; offerId: string; verdict: string };

const answer = z.object({ text: z.string() });
const agent = (name: string, tools: AgentSpec['tools'] = []) =>
  defineAgent({ name, prompt: `${name}.md`, model: ModelTier.Fast, tools, output: answer });

const reply = (value: unknown): InferenceOutput => ({
  items: [ModelMessageItem.rehydrate({ text: JSON.stringify(value) })],
  tokenUsage: undefined,
  rowResponse: undefined,
});
const callTool = (name: string, args: unknown): InferenceOutput => ({
  items: [FunctionCallItem.rehydrate({ callId: `call-${name}`, name, args: JSON.stringify(args) })],
  tokenUsage: undefined,
  rowResponse: undefined,
});

/** Who is thinking: the prompt text the loop's context starts with. */
const agentOf = (input: InferenceInput) => {
  const first = input.context.getItems()[0];
  return first instanceof DeveloperMessageItem ? first.content.text : '';
};
const lastUserMessage = (input: InferenceInput) =>
  input.context.getItems().findLast((i) => i instanceof UserMessageItem)?.content.text ?? '';
const lastToolOutput = (input: InferenceInput) =>
  input.context.getItems().findLast((i) => i instanceof FunctionCallOutputItem)?.output.text;

const model = (run: (input: InferenceInput) => Promise<InferenceOutput>): InferenceRunner => ({
  run,
  stream: () => {
    throw new Error('the adapter never streams');
  },
});

function setup(
  inference: InferenceRunner,
  extra: Partial<MozaikRuntimeConfig<{ spent: number }>> = {},
) {
  const log = createMemoryRunLog();
  const runtime = createMozaikRuntime<TestEvent, { spent: number }>({
    sessionId: 's-1',
    state: { spent: 0 },
    log,
    models: { fast: 'gpt-5.4-mini', strong: 'gpt-5.5' },
    clock: () => new Date('2026-11-26T15:00:00.000Z'),
    loadPrompt: (file) => file.replace('.md', ''),
    inference,
    ...extra,
  });
  return { runtime, log };
}

const ok = <O>(result: LoopResult<O>) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
  return result.output;
};

describe('Mozaik runtime: loops', () => {
  it('runs five scout loops concurrently through runLoop', async () => {
    let thinking = 0;
    let release!: () => void;
    const allThinking = new Promise<void>((resolve) => (release = resolve));
    const { runtime, log } = setup(
      model(async (input) => {
        thinking += 1;
        if (thinking === 5) release();
        await allThinking;
        return reply({ text: `${agentOf(input)} done` });
      }),
    );

    const handles = ['a', 'b', 'c', 'd', 'e'].map((s) => runtime.start(agent(`scout-${s}`), 'go'));
    const results = await Promise.all(handles.map((h) => h.done));

    expect(results.map((r) => ok(r).text)).toEqual(
      ['a', 'b', 'c', 'd', 'e'].map((s) => `scout-${s} done`),
    );
    const kinds = log.lines().map((l) => l.kind);
    expect(kinds.lastIndexOf('loop.started')).toBeLessThan(kinds.indexOf('loop.finished'));
  });

  it('keeps two loops of the same agent apart', async () => {
    const seen: string[] = [];
    const { runtime } = setup(
      model((input) => {
        seen.push(`${input.context.getItems().length}:${lastUserMessage(input)}`);
        return Promise.resolve(reply({ text: lastUserMessage(input) }));
      }),
    );
    const verifier = agent('deal-verifier');
    const [one, two] = [runtime.start(verifier, 'offer b'), runtime.start(verifier, 'offer c')];
    expect(ok(await one.done).text).toBe('offer b');
    expect(ok(await two.done).text).toBe('offer c');
    // Each context holds only its own developer message and user message.
    expect(seen.sort()).toEqual(['2:offer b', '2:offer c']);
  });

  it('gives every session its own Mozaik runtime', async () => {
    const first = setup(model(() => Promise.resolve(reply({ text: 'one' }))));
    const second = setup(model(() => Promise.resolve(reply({ text: 'two' }))));
    expect(ok(await first.runtime.start(agent('scout-a'), 'go').done).text).toBe('one');
    expect(ok(await second.runtime.start(agent('scout-a'), 'go').done).text).toBe('two');
  });

  it('passes the tier model, the tools and the output schema to the model', async () => {
    const inputs: InferenceInput[] = [];
    const tool = defineTool({
      name: 'catalog',
      description: 'Lists offers.',
      input: z.object({ query: z.string() }),
      output: z.object({ offers: z.array(z.string()) }),
      run: () => Promise.resolve({ offers: [] }),
    });
    const { runtime } = setup(
      model((input) => {
        inputs.push(input);
        return Promise.resolve(reply({ text: 'x' }));
      }),
    );
    await runtime.start(
      defineAgent({ ...agent('reviewer', [tool]), model: ModelTier.Strong }),
      'go',
    ).done;
    expect(inputs[0]?.model).toBe('gpt-5.5');
    expect(inputs[0]?.tools?.[0]).toMatchObject({
      name: 'catalog',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    });
    expect(inputs[0]?.structuredOutput?.schema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
  });

  it('turns a failing model call into a failed result instead of crashing', async () => {
    const { runtime } = setup(model(() => Promise.reject(new Error('401 no API key'))));
    expect(await runtime.start(agent('scout-a'), 'go').done).toEqual({
      ok: false,
      reason: 'failed',
      detail: '401 no API key',
    });
  });

  it('drops an answer that is not JSON or does not match the schema', async () => {
    const notJson = setup(
      model(() =>
        Promise.resolve({
          items: [ModelMessageItem.rehydrate({ text: 'sure!' })],
          tokenUsage: undefined,
          rowResponse: undefined,
        }),
      ),
    );
    expect(await notJson.runtime.start(agent('scout-a'), 'go').done).toMatchObject({
      reason: 'invalid_output',
    });
    const wrongShape = setup(model(() => Promise.resolve(reply({ text: 7 }))));
    expect(await wrongShape.runtime.start(agent('scout-a'), 'go').done).toMatchObject({
      reason: 'invalid_output',
    });
  });

  it('runs the output check on the final answer', async () => {
    const { runtime } = setup(
      model(() => Promise.resolve(reply({ text: 'was 649' }))),
      {
        checkOutput: () => ({ ok: false, detail: '649 has no record' }),
      },
    );
    expect(await runtime.start(agent('reviewer'), 'go').done).toEqual({
      ok: false,
      reason: 'rejected',
      detail: '649 has no record',
    });
  });

  it('fails a loop that never answers, so idle() cannot hang', async () => {
    const { runtime } = setup(
      model(() => new Promise<never>(() => undefined)),
      {
        loopTimeoutMs: 20,
      },
    );
    const handle = runtime.start(agent('scout-a'), 'go');
    await runtime.idle();
    expect(await handle.done).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('Mozaik runtime: events and situation handlers', () => {
  it('starts the reacting agent on each offer and publishes its verdict', async () => {
    const { runtime, log } = setup(
      model((input) => Promise.resolve(reply({ text: `checked ${lastUserMessage(input)}` }))),
    );
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

    expect(verdicts.map((v) => v.type === 'verdict.ready' && v.verdict).sort()).toEqual([
      'checked b-tv55',
      'checked c-tv55',
    ]);
    for (const line of log.lines()) expect(RunLogLine.safeParse(line).success).toBe(true);
  });

  it('logs a throwing observer and keeps delivering', () => {
    const { runtime, log } = setup(model(() => Promise.resolve(reply({ text: 'x' }))));
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

describe('Mozaik runtime: interception', () => {
  const payRun = vi.fn(() => Promise.resolve({ signature: 'mock-1' }));
  const pay = defineTool({
    name: 'pay',
    description: 'Pays a store from the session wallet.',
    input: z.object({ storeId: z.string(), amountCents: z.int() }),
    output: z.object({ signature: z.string() }),
    run: payRun,
  });

  // Asks to pay, then answers with whatever the tool returned.
  const payingModel = (amountCents: number) =>
    model((input) => {
      const output = lastToolOutput(input);
      return Promise.resolve(
        output === undefined
          ? callTool('pay', { storeId: 'd', amountCents })
          : reply({ text: output }),
      );
    });

  const guard = (maxCents: number): ToolInterceptor => ({
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

  it('blocks a payment above the mandate before pay() runs', async () => {
    payRun.mockClear();
    const { runtime, log } = setup(payingModel(64800));
    runtime.intercept(guard(60000));

    const result = await runtime.start(agent('budget', [pay]), 'pay store D').done;

    expect(payRun).not.toHaveBeenCalled();
    expect(JSON.parse(ok(result).text)).toEqual({ blocked: true, reason: '64800 > 60000' });
    expect(log.lines()).toContainEqual(
      expect.objectContaining({ kind: 'tool.blocked', tool: 'pay', interceptor: 'mandate-guard' }),
    );
  });

  it('lets a payment inside the mandate through', async () => {
    payRun.mockClear();
    const { runtime } = setup(payingModel(58500));
    runtime.intercept(guard(60000));
    const result = await runtime.start(agent('budget', [pay]), 'pay store B').done;
    expect(payRun).toHaveBeenCalledOnce();
    expect(JSON.parse(ok(result).text)).toEqual({ signature: 'mock-1' });
  });

  it('blocks when the interceptor throws (fails closed)', async () => {
    payRun.mockClear();
    const { runtime } = setup(payingModel(100));
    runtime.intercept({
      name: 'mandate-guard',
      matches: () => true,
      decide: () => Promise.reject(new Error('mandate missing')),
    });
    const result = await runtime.start(agent('budget', [pay]), 'pay').done;
    expect(payRun).not.toHaveBeenCalled();
    expect(JSON.parse(ok(result).text)).toMatchObject({ blocked: true });
  });

  it('collects the records a tool registers', async () => {
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
    const { runtime } = setup(
      model((input) =>
        Promise.resolve(
          lastToolOutput(input) === undefined
            ? callTool('price_history', { offerId: 'b-tv55' })
            : reply({ text: 'ok' }),
        ),
      ),
    );
    await runtime.start(agent('deal-verifier', [priceHistory]), 'check').done;
    expect(runtime.records.get('b-tv55-ph-1')).toEqual({ recordId: 'b-tv55-ph-1', cents: 69900 });
  });
});
