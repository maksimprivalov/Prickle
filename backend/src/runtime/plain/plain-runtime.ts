import { z } from 'zod';
import type {
  AgentSpec,
  EventOf,
  InterceptDecision,
  LoopHandle,
  LoopResult,
  OutputCheck,
  Runtime,
  RuntimeEvent,
  ToolCall,
  ToolInterceptor,
} from '../port';
import { LoopFailure } from '../port';
import { createRecordRegistry } from '../record-registry';
import type { RunLog, RunLogLine } from '../run-log';

// The same port as the Mozaik adapter, with no framework: loops are plain promises started
// without awaiting, events fan out synchronously to listeners. For tests and as proof that
// nothing above the port depends on Mozaik.

/** Stands in for the model: gets the message and the agent's tools, returns the final answer. */
export type ModelDriver = (request: {
  readonly agent: AgentSpec;
  readonly loopId: string;
  readonly message: string;
  readonly callTool: (name: string, input: unknown) => Promise<unknown>;
}) => Promise<unknown>;

export type PlainRuntimeConfig<S> = {
  readonly sessionId: string;
  readonly state: S;
  readonly driver: ModelDriver;
  readonly log: RunLog;
  readonly clock?: () => Date;
  readonly checkOutput?: OutputCheck;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type LogEntry = DistributiveOmit<RunLogLine, 'seq' | 'at' | 'sessionId'>;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createPlainRuntime<E extends RuntimeEvent, S>(
  config: PlainRuntimeConfig<S>,
): Runtime<E, S> {
  const { sessionId, state, driver, log, checkOutput } = config;
  const clock = config.clock ?? (() => new Date());
  const records = createRecordRegistry();
  const interceptors: ToolInterceptor[] = [];
  const listeners = new Map<string, ((event: E) => void)[]>();
  const active = new Set<Promise<unknown>>();
  const loopCounts = new Map<string, number>();
  let seq = 0;

  function write(entry: LogEntry): void {
    log.append({ ...entry, seq: seq++, at: clock().toISOString(), sessionId });
  }

  function track(promise: Promise<unknown>): void {
    active.add(promise);
    const remove = () => active.delete(promise);
    promise.then(remove, remove);
  }

  async function decide(call: ToolCall): Promise<{ by: string; decision: InterceptDecision }> {
    for (const interceptor of interceptors) {
      try {
        if (!interceptor.matches(call)) continue;
        const decision = await interceptor.decide(call);
        if (!decision.allow) return { by: interceptor.name, decision };
      } catch (error) {
        // Fail closed: an interceptor that cannot decide blocks the call.
        return {
          by: interceptor.name,
          decision: { allow: false, reason: `interceptor failed: ${messageOf(error)}` },
        };
      }
    }
    return { by: '', decision: { allow: true } };
  }

  async function callTool(
    agent: AgentSpec,
    loopId: string,
    name: string,
    rawInput: unknown,
  ): Promise<unknown> {
    const tool = agent.tools.find((t) => t.name === name);
    if (!tool) return { error: `${agent.name} has no tool named ${name}` };

    const input = tool.input.safeParse(rawInput);
    if (!input.success) {
      return { error: `invalid input for ${name}: ${z.prettifyError(input.error)}` };
    }

    const call: ToolCall = { agent: agent.name, loopId, tool: name, input: input.data };
    const { by, decision } = await decide(call);
    const where = { agent: agent.name, loopId, tool: name };
    if (!decision.allow) {
      write({ kind: 'tool.blocked', ...where, interceptor: by, reason: decision.reason });
      return { blocked: true, reason: decision.reason };
    }

    write({ kind: 'tool.called', ...where });
    try {
      const output = tool.output.parse(
        await tool.run(input.data, { sessionId, agent: agent.name, records }),
      );
      write({ kind: 'tool.returned', ...where, ok: true });
      return output;
    } catch (error) {
      write({ kind: 'tool.returned', ...where, ok: false });
      return { error: `${name} failed: ${messageOf(error)}` };
    }
  }

  async function runLoop<O>(
    agent: AgentSpec<O>,
    loopId: string,
    message: string,
  ): Promise<LoopResult<O>> {
    const finish = (result: LoopResult<O>): LoopResult<O> => {
      write({
        kind: 'loop.finished',
        agent: agent.name,
        loopId,
        outcome: result.ok ? 'ok' : result.reason,
        detail: result.ok ? '' : result.detail,
      });
      return result;
    };
    const fail = (reason: LoopFailure, detail: string) => finish({ ok: false, reason, detail });

    let answer: unknown;
    try {
      answer = await driver({
        agent,
        loopId,
        message,
        callTool: (name, input) => callTool(agent, loopId, name, input),
      });
    } catch (error) {
      return fail(LoopFailure.Failed, messageOf(error));
    }

    const parsed = agent.output.safeParse(answer);
    if (!parsed.success) return fail(LoopFailure.InvalidOutput, z.prettifyError(parsed.error));

    if (checkOutput) {
      try {
        const check = checkOutput(agent, parsed.data, records);
        if (!check.ok) return fail(LoopFailure.Rejected, check.detail);
      } catch (error) {
        return fail(LoopFailure.Rejected, `output check failed: ${messageOf(error)}`);
      }
    }
    return finish({ ok: true, output: parsed.data });
  }

  function start<O>(agent: AgentSpec<O>, message: string): LoopHandle<O> {
    const n = (loopCounts.get(agent.name) ?? 0) + 1;
    loopCounts.set(agent.name, n);
    const loopId = `${agent.name}#${n}`;
    write({ kind: 'loop.started', agent: agent.name, loopId });
    const done = runLoop(agent, loopId, message);
    track(done);
    return { agent: agent.name, loopId, done };
  }

  function observe(type: E['type'] | '*', listener: (event: E) => void): void {
    const list = listeners.get(type) ?? [];
    list.push(listener);
    listeners.set(type, list);
  }

  function guarded(run: () => void): void {
    try {
      run();
    } catch (error) {
      write({ kind: 'handler.failed', detail: messageOf(error) });
    }
  }

  return {
    sessionId,
    state,
    records,
    start,
    observe,

    publish(event) {
      write({ kind: 'event', event });
      for (const listener of [
        ...(listeners.get(event.type) ?? []),
        ...(listeners.get('*') ?? []),
      ]) {
        guarded(() => listener(event));
      }
    },

    react(agent, type, reaction) {
      observe(type, (event) => {
        // Listeners for `type` only ever receive events of that type.
        const typed = event as EventOf<E, typeof type>;
        guarded(() => {
          const message = reaction.message(typed);
          if (message === undefined) return;
          const handle = start(agent, message);
          track(handle.done.then((result) => guarded(() => reaction.done(result, typed))));
        });
      });
    },

    intercept(interceptor) {
      interceptors.push(interceptor);
    },

    async idle() {
      // A finishing loop can start new ones (through reactions), so wait until none are left.
      while (active.size > 0) await Promise.allSettled([...active]);
    },
  };
}
