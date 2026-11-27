import { randomUUID } from 'node:crypto';
import {
  DeveloperMessageItem,
  FunctionCallItem,
  ModelContext,
  ModelMessageItem,
  RuntimeState,
  SemanticEvent,
  SituationSpecification,
  createAgent,
  createHuman,
  defineRuntime,
  supportedModels,
  type Agent,
  type ExecutableTransition,
  type InferenceInput,
  type InferenceOutput,
  type InferenceRunner,
  type InterceptionHandler,
  type Participant,
  type SituationContext,
  type SituationHandler,
  type Tool,
} from '@mozaik-ai/core';
import { z } from 'zod';
import { loadPrompt } from '../load-prompt';
import {
  createLogWriter,
  createLoopIds,
  createLoopTracker,
  decideToolCall,
  guarded,
  invokeTool,
  logLoopFinished,
  matchesAny,
  messageOf,
  parseToolInput,
  settleAnswer,
  type LogWriter,
} from '../loop-kit';
import type {
  AgentSpec,
  EventOf,
  LoopHandle,
  LoopResult,
  ModelTier,
  OutputCheck,
  RecordRegistry,
  Runtime,
  RuntimeEvent,
  ToolCall,
  ToolInterceptor,
  ToolSpec,
} from '../port';
import { LoopFailure } from '../port';
import { createRecordRegistry } from '../record-registry';
import type { RunLog } from '../run-log';

// The port on @mozaik-ai/core 6. The only file that imports Mozaik. What the judges score is
// used for real here:
//   - every agent is a Mozaik participant; loops start with runLoop and are never awaited;
//   - `react` registers a situation handler on the agent's own participant;
//   - tool calls pass a Mozaik InterceptionHandler before they run (the mandate guard), and the
//     final answer passes it too (the output check) before anyone sees it;
//   - our events travel as Mozaik semantic events, so Mozaik Cloud shows them.
// Signatures checked against node_modules/@mozaik-ai/core/dist/index.d.ts (6.0.0).

export type MozaikRuntimeConfig<S> = {
  readonly sessionId: string;
  readonly state: S;
  readonly log: RunLog;
  /** Model name per tier, from Mozaik's supported models (e.g. "gpt-5.4-mini"). */
  readonly models: Readonly<Record<ModelTier, string>>;
  /**
   * A model for one agent by name, over its tier's. Free-tier quotas are per model, so moving
   * an agent that makes few calls to another model frees requests for the rest.
   */
  readonly agentModels?: Readonly<Record<string, string>>;
  readonly clock?: () => Date;
  readonly checkOutput?: OutputCheck;
  /** Default: src/prompts/<file>. */
  readonly loadPrompt?: (file: string) => string;
  /** A loop with no answer by then fails, so idle() cannot hang. Default 120 s. */
  readonly loopTimeoutMs?: number;
  /**
   * Tool calls one loop may make. Past it the agent is told to answer; two calls later the loop
   * is stopped. A model that keeps searching would otherwise spend the whole model quota.
   * Default 8.
   */
  readonly maxToolCallsPerLoop?: number;
  /** Replaces the model call. Tests pass a scripted runner; the default is Mozaik's providers. */
  readonly inference?: InferenceRunner;
};

/** Our shared state rides on Mozaik's runtime state, next to the participant registry. */
class SessionState<S> extends RuntimeState {
  constructor(readonly session: S) {
    super();
  }
}

class Matching extends SituationSpecification {
  constructor(private readonly test: (event: SemanticEvent) => boolean) {
    super();
  }
  isSatisfiedBy({ event }: SituationContext): boolean {
    return this.test(event);
  }
}

/** Mozaik's default model dispatch: pick the provider endpoint by model name. */
const providers: InferenceRunner = {
  run(input) {
    const model = supportedModels.find((m) => m.specification.name === input.model);
    if (!model) return Promise.reject(new Error(`Unsupported model: ${input.model}`));
    return model.endpoint.infer(input);
  },
  async *stream(input) {
    const model = supportedModels.find((m) => m.specification.name === input.model);
    if (!model) throw new Error(`Unsupported model: ${input.model}`);
    yield* model.endpoint.stream(input);
  },
};

/**
 * Mozaik does not catch a failed model call: the loop's promise rejects with nobody listening.
 * This runner turns a failure into an empty answer, so the loop still ends normally, and
 * remembers the error by context id so the loop's result says what went wrong.
 */
function safeInference(inner: InferenceRunner, failures: Map<string, string>): InferenceRunner {
  const failed = (input: InferenceInput, detail: string): InferenceOutput => {
    // The detail ends up in the run log, which may be committed. Providers send keys in
    // headers, not messages, but a key-shaped string is scrubbed anyway (Google keys: "AIza…").
    failures.set(input.context.id, detail.replaceAll(/AIza[0-9A-Za-z_-]{20,}/g, '[api key]'));
    return {
      items: [ModelMessageItem.rehydrate({ text: '' })],
      tokenUsage: undefined,
      rowResponse: undefined,
    };
  };
  return {
    async run(input) {
      try {
        const output = await inner.run(input);
        const answers = output.items.some(
          (i) => i.type === 'function_call' || i.type === 'message',
        );
        return answers
          ? output
          : failed(input, 'the model returned neither a tool call nor an answer');
      } catch (error) {
        return failed(input, messageOf(error));
      }
    },
    stream: (input) => inner.stream(input),
  };
}

// Providers take a bare JSON Schema; the "$schema" dialect key is dropped.
const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(z.toJSONSchema(schema, { unrepresentable: 'any' })).filter(
      ([key]) => key !== '$schema',
    ),
  );

/** A blocked call's arguments are replaced by this marker, so the tool returns the reason. */
const BLOCKED = '__prickle_blocked';
const BlockedArgs = z.object({ [BLOCKED]: z.string() });

export function createMozaikRuntime<E extends RuntimeEvent, S>(
  config: MozaikRuntimeConfig<S>,
): Runtime<E, S> {
  const { sessionId, state, checkOutput } = config;
  const write: LogWriter = createLogWriter(
    config.log,
    sessionId,
    config.clock ?? (() => new Date()),
  );
  const prompt = config.loadPrompt ?? loadPrompt;
  const timeoutMs = config.loopTimeoutMs ?? 120_000;
  const maxToolCalls = config.maxToolCallsPerLoop ?? 8;
  const records: RecordRegistry = createRecordRegistry();
  const interceptors: ToolInterceptor[] = [];
  const loops = createLoopTracker();
  const nextLoopId = createLoopIds();
  const failures = new Map<string, string>();

  // defineRuntime keeps its runtime in a closure, so each session gets its own.
  const mozaik = defineRuntime<SessionState<S>>();
  mozaik.initializeRuntime({
    state: new SessionState(state),
    inferenceRunnerConfig: { runner: safeInference(config.inference ?? providers, failures) },
  });

  // The shopper: the human participant our events are sent from.
  const shopper = createHuman({ name: 'shopper', capabilities: ['mandate'], handlers: [] });
  mozaik.join(shopper);

  const participants = new Map<string, Agent>();
  function participantFor(agent: AgentSpec): Agent {
    const existing = participants.get(agent.name);
    if (existing) return existing;
    const created = createAgent({
      name: agent.name,
      capabilities: ['inference', ...agent.tools.map((t) => t.name)],
      instruction: prompt(agent.prompt),
      // Shown in Mozaik Cloud. The tools a loop really calls are bound per loop in start().
      tools: agent.tools.map((t) => toolFor(t, () => Promise.resolve({ error: 'not in a loop' }))),
      handlers: [],
    });
    participants.set(agent.name, created);
    mozaik.join(created);
    return created;
  }

  function addHandler(participant: Participant, handler: SituationHandler): void {
    participant.setHandlers([...participant.getHandlers(), handler]);
  }

  // Our events, by the Mozaik event object that carries them.
  const domainEvents = new WeakMap<SemanticEvent, E>();

  function toolFor(tool: ToolSpec, invoke: (args: unknown) => Promise<unknown>): Tool {
    return {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: jsonSchema(tool.input),
      strict: false,
      invoke,
    };
  }

  function toolCall(
    agent: AgentSpec,
    loopId: string,
    item: FunctionCallItem,
  ): ToolCall | undefined {
    const tool = agent.tools.find((t) => t.name === item.name);
    if (!tool) return undefined;
    let args: unknown;
    try {
      args = JSON.parse(item.args);
    } catch {
      return undefined;
    }
    const parsed = parseToolInput(tool, args);
    // Invalid input never reaches the tool (it fails parsing in invoke), so it needs no decision.
    return parsed.ok
      ? { agent: agent.name, loopId, tool: tool.name, input: parsed.input }
      : undefined;
  }

  function start<O>(agent: AgentSpec<O>, message: string): LoopHandle<O> {
    const loopId = nextLoopId(agent.name);
    const participant = participantFor(agent);
    write({ kind: 'loop.started', agent: agent.name, loopId });

    let settle!: (result: LoopResult<O>) => void;
    const done = new Promise<LoopResult<O>>((resolve) => (settle = resolve));
    let settled = false;
    const timer = setTimeout(() => {
      finish({ ok: false, reason: LoopFailure.Failed, detail: `no answer within ${timeoutMs} ms` });
    }, timeoutMs);
    timer.unref();
    function finish(result: LoopResult<O>): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logLoopFinished(write, agent.name, loopId, result);
      settle(result);
    }

    // A fresh context per loop: two loops of one agent (the verifier on two offers) must not
    // see each other's messages.
    const context = ModelContext.create().addContextItem(
      DeveloperMessageItem.create(participant.getDeveloperMessage()),
    );

    const blocked = new Map<string, string>();
    let toolCalls = 0;

    /** Ends the loop at this step: Mozaik runs no further model call for it. */
    const stop = (): ExecutableTransition => ({
      nextStateId: 'model_message',
      input: { answer: ModelMessageItem.rehydrate({ text: '' }) },
    });

    /** Replaces a call's arguments by a marker, so the tool answers with the reason instead. */
    const block = (
      transition: Extract<ExecutableTransition, { nextStateId: 'function_call' }>,
      by: string,
      reason: string,
    ): ExecutableTransition => {
      const original = transition.input.call;
      write({
        kind: 'tool.blocked',
        agent: agent.name,
        loopId,
        tool: original.name,
        interceptor: by,
        reason,
      });
      const token = randomUUID();
      blocked.set(token, reason);
      return {
        nextStateId: 'function_call',
        input: {
          ...transition.input,
          call: FunctionCallItem.rehydrate({
            callId: original.callId,
            name: original.name,
            args: JSON.stringify({ [BLOCKED]: token }),
          }),
        },
      };
    };
    const tools = agent.tools.map((tool) =>
      toolFor(tool, async (args) => {
        const marker = BlockedArgs.safeParse(args);
        const reason = marker.success ? blocked.get(marker.data[BLOCKED]) : undefined;
        if (reason !== undefined) return { blocked: true, reason };
        const parsed = parseToolInput(tool, args);
        if (!parsed.ok) return parsed.output;
        return invokeTool(tool, parsed.input, {
          sessionId,
          agent: agent.name,
          loopId,
          records,
          write,
        });
      }),
    );

    const interception: InterceptionHandler = {
      isSatisfiedBy(transition) {
        // A loop that already ended (timed out, stopped) is stopped at whatever step comes next.
        if (settled) return true;
        // Every tool call is counted; every answer is checked.
        return (
          transition.nextStateId === 'model_message' || transition.nextStateId === 'function_call'
        );
      },
      async handle(transition): Promise<ExecutableTransition> {
        if (settled) return stop();
        if (transition.nextStateId === 'model_message') {
          const failure = failures.get(context.id);
          if (failure !== undefined) {
            finish({ ok: false, reason: LoopFailure.Failed, detail: failure });
          } else {
            finish(settleText(agent, transition.input.answer.content.text));
          }
          return transition;
        }
        if (transition.nextStateId !== 'function_call') return transition;

        toolCalls += 1;
        if (toolCalls > maxToolCalls + 2) {
          finish({
            ok: false,
            reason: LoopFailure.Failed,
            detail: `stopped after ${maxToolCalls} tool calls without an answer`,
          });
          return stop();
        }
        if (toolCalls > maxToolCalls) {
          return block(
            transition,
            'loop-limit',
            `You have made ${maxToolCalls} tool calls. Do not call tools again: give your final answer now.`,
          );
        }

        const call = toolCall(agent, loopId, transition.input.call);
        if (!call || !matchesAny(interceptors, call)) return transition;
        const { by, decision } = await decideToolCall(interceptors, call);
        return decision.allow ? transition : block(transition, by, decision.reason);
      },
    };

    mozaik.runLoop(
      participant.getId(),
      message,
      {
        model: config.agentModels?.[agent.name] ?? config.models[agent.model],
        context,
        tools,
        structuredOutput: {
          name: agent.name.replace(/[^A-Za-z0-9_-]/g, '_'),
          schema: jsonSchema(agent.output),
          strict: false,
        },
      },
      interception,
    );
    loops.track(done);
    return { agent: agent.name, loopId, done };
  }

  function settleText<O>(agent: AgentSpec<O>, text: string): LoopResult<O> {
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      return { ok: false, reason: LoopFailure.InvalidOutput, detail: 'the answer is not JSON' };
    }
    return settleAnswer(agent, answer, checkOutput, records);
  }

  function observe(type: E['type'] | '*', listener: (event: E) => void): void {
    const ours = (event: SemanticEvent) => {
      const domain = domainEvents.get(event);
      return domain !== undefined && (type === '*' || domain.type === type);
    };
    addHandler(shopper, {
      specification: new Matching(ours),
      processor: {
        apply({ event }) {
          const domain = domainEvents.get(event);
          if (domain) guarded(write, () => listener(domain));
        },
      },
    });
  }

  return {
    sessionId,
    state,
    records,
    start,
    observe,

    publish(event) {
      write({ kind: 'event', event });
      const semantic = SemanticEvent.create(event.type, shopper.getId(), event);
      domainEvents.set(semantic, event);
      mozaik.sendEvent(semantic, shopper.getId());
    },

    react(agent, type, reaction) {
      addHandler(participantFor(agent), {
        specification: new Matching((event) => domainEvents.get(event)?.type === type),
        processor: {
          apply({ event }) {
            const domain = domainEvents.get(event);
            if (!domain) return;
            // The specification only lets events of `type` through.
            const typed = domain as EventOf<E, typeof type>;
            guarded(write, () => {
              const message = reaction.message(typed);
              if (message === undefined) return;
              const handle = start(agent, message);
              loops.track(
                handle.done.then((result) => guarded(write, () => reaction.done(result, typed))),
              );
            });
          },
        },
      });
    },

    intercept(interceptor) {
      interceptors.push(interceptor);
    },

    idle: () => loops.idle(),
  };
}
