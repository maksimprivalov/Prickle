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
  readonly clock?: () => Date;
  readonly checkOutput?: OutputCheck;
  /** Default: src/prompts/<file>. */
  readonly loadPrompt?: (file: string) => string;
  /** A loop with no answer by then fails, so idle() cannot hang. Default 120 s. */
  readonly loopTimeoutMs?: number;
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
    failures.set(input.context.id, detail);
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
        if (transition.nextStateId === 'model_message') return true;
        if (transition.nextStateId !== 'function_call') return false;
        const call = toolCall(agent, loopId, transition.input.call);
        return call !== undefined && matchesAny(interceptors, call);
      },
      async handle(transition): Promise<ExecutableTransition> {
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

        const call = toolCall(agent, loopId, transition.input.call);
        if (!call) return transition;
        const { by, decision } = await decideToolCall(interceptors, call);
        if (decision.allow) return transition;

        write({
          kind: 'tool.blocked',
          agent: agent.name,
          loopId,
          tool: call.tool,
          interceptor: by,
          reason: decision.reason,
        });
        const token = randomUUID();
        blocked.set(token, decision.reason);
        const original = transition.input.call;
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
      },
    };

    mozaik.runLoop(
      participant.getId(),
      message,
      {
        model: config.models[agent.model],
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
