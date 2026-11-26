import {
  createLogWriter,
  createLoopIds,
  createLoopTracker,
  decideToolCall,
  guarded,
  invokeTool,
  logLoopFinished,
  messageOf,
  parseToolInput,
  settleAnswer,
} from '../loop-kit';
import type {
  AgentSpec,
  EventOf,
  LoopHandle,
  LoopResult,
  OutputCheck,
  Runtime,
  RuntimeEvent,
  ToolInterceptor,
} from '../port';
import { LoopFailure } from '../port';
import { createRecordRegistry } from '../record-registry';
import type { RunLog } from '../run-log';

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

export function createPlainRuntime<E extends RuntimeEvent, S>(
  config: PlainRuntimeConfig<S>,
): Runtime<E, S> {
  const { sessionId, state, driver, checkOutput } = config;
  const write = createLogWriter(config.log, sessionId, config.clock ?? (() => new Date()));
  const records = createRecordRegistry();
  const interceptors: ToolInterceptor[] = [];
  const listeners = new Map<string, ((event: E) => void)[]>();
  const loops = createLoopTracker();
  const nextLoopId = createLoopIds();

  async function callTool(
    agent: AgentSpec,
    loopId: string,
    name: string,
    raw: unknown,
  ): Promise<unknown> {
    const tool = agent.tools.find((t) => t.name === name);
    if (!tool) return { error: `${agent.name} has no tool named ${name}` };
    const parsed = parseToolInput(tool, raw);
    if (!parsed.ok) return parsed.output;

    const call = { agent: agent.name, loopId, tool: name, input: parsed.input };
    const { by, decision } = await decideToolCall(interceptors, call);
    if (!decision.allow) {
      write({
        kind: 'tool.blocked',
        agent: agent.name,
        loopId,
        tool: name,
        interceptor: by,
        reason: decision.reason,
      });
      return { blocked: true, reason: decision.reason };
    }
    return invokeTool(tool, parsed.input, { sessionId, agent: agent.name, loopId, records, write });
  }

  async function runLoop<O>(
    agent: AgentSpec<O>,
    loopId: string,
    message: string,
  ): Promise<LoopResult<O>> {
    let result: LoopResult<O>;
    try {
      const answer = await driver({
        agent,
        loopId,
        message,
        callTool: (name, input) => callTool(agent, loopId, name, input),
      });
      result = settleAnswer(agent, answer, checkOutput, records);
    } catch (error) {
      result = { ok: false, reason: LoopFailure.Failed, detail: messageOf(error) };
    }
    logLoopFinished(write, agent.name, loopId, result);
    return result;
  }

  function start<O>(agent: AgentSpec<O>, message: string): LoopHandle<O> {
    const loopId = nextLoopId(agent.name);
    write({ kind: 'loop.started', agent: agent.name, loopId });
    const done = runLoop(agent, loopId, message);
    loops.track(done);
    return { agent: agent.name, loopId, done };
  }

  function observe(type: E['type'] | '*', listener: (event: E) => void): void {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  }

  return {
    sessionId,
    state,
    records,
    start,
    observe,

    publish(event) {
      write({ kind: 'event', event });
      const targets = [...(listeners.get(event.type) ?? []), ...(listeners.get('*') ?? [])];
      for (const listener of targets) guarded(write, () => listener(event));
    },

    react(agent, type, reaction) {
      observe(type, (event) => {
        // Listeners for `type` only ever receive events of that type.
        const typed = event as EventOf<E, typeof type>;
        const message = reaction.message(typed);
        if (message === undefined) return;
        const handle = start(agent, message);
        loops.track(
          handle.done.then((result) => guarded(write, () => reaction.done(result, typed))),
        );
      });
    },

    intercept(interceptor) {
      interceptors.push(interceptor);
    },

    idle: () => loops.idle(),
  };
}
