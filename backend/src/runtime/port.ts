import type { z } from 'zod';

// Our own runtime interface. Agents, tools and app/ talk to this, never to Mozaik. Two adapters
// implement it: runtime/mozaik/ (the real one, scored by the judges) and runtime/plain/ (tests
// and portability proof). Keep it to what the five agents need.

// ---------------------------------------------------------------------------------------------
// Records: every number an agent reports must point at one of these (fix 1).

/** Anything a tool returns that carries a number has a stable record id. */
export type SourcedRecord = { readonly recordId: string };

/** Every record a tool returned in this run. The grounding check reads it. */
export type RecordRegistry = {
  add(records: readonly SourcedRecord[]): void;
  get(recordId: string): SourcedRecord | undefined;
  all(): readonly SourcedRecord[];
};

// ---------------------------------------------------------------------------------------------
// Tools: plain async functions with zod schemas. The adapter wraps them for the framework.

export type ToolContext = {
  readonly sessionId: string;
  /** The agent instance calling the tool, e.g. "scout-c". */
  readonly agent: string;
  /** Register every record you return here, or the grounding check rejects its numbers. */
  readonly records: RecordRegistry;
};

export type ToolSpec<I = unknown, O = unknown> = {
  /** snake_case, as the model sees it: "price_history". */
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  run(input: I, ctx: ToolContext): Promise<O>;
};

/** Infers the input and output types from the schemas, so `run` is typed without annotations. */
export function defineTool<I, O>(spec: ToolSpec<I, O>): ToolSpec<I, O> {
  return spec;
}

// ---------------------------------------------------------------------------------------------
// Agents: plain data. The adapter turns a spec into a framework agent.

export const ModelTier = { Fast: 'fast', Strong: 'strong' } as const;
export type ModelTier = (typeof ModelTier)[keyof typeof ModelTier];

export type AgentSpec<O = unknown> = {
  /** Unique per instance: the five scouts are "scout-a" … "scout-e". */
  readonly name: string;
  /** File name in src/prompts/, e.g. "deal-verifier.md". */
  readonly prompt: string;
  /** Fast for scouts, Strong for the checkers and the reviewer. */
  readonly model: ModelTier;
  readonly tools: readonly ToolSpec[];
  /** The final answer is parsed with this; a parse failure drops the output. */
  readonly output: z.ZodType<O>;
  /**
   * Tool calls one loop of this agent may make before it is told to answer (and, two calls
   * later, stopped). Overrides the runtime's default. Scouts need one or two searches.
   */
  readonly maxToolCalls?: number;
};

export function defineAgent<O>(spec: AgentSpec<O>): AgentSpec<O> {
  return spec;
}

// ---------------------------------------------------------------------------------------------
// Loops

export const LoopFailure = {
  /** The final answer did not match the agent's output schema. */
  InvalidOutput: 'invalid_output',
  /** The output check (number grounding) rejected the answer. */
  Rejected: 'rejected',
  /** The model call or the loop itself threw. */
  Failed: 'failed',
} as const;
export type LoopFailure = (typeof LoopFailure)[keyof typeof LoopFailure];

export type LoopResult<O> =
  | { readonly ok: true; readonly output: O }
  | { readonly ok: false; readonly reason: LoopFailure; readonly detail: string };

export type LoopHandle<O> = {
  readonly agent: string;
  readonly loopId: string;
  /** Settles when the loop ends. Never rejects: failures are a LoopResult. */
  readonly done: Promise<LoopResult<O>>;
};

/** Checks an agent's parsed output before anyone else sees it. Core grounding plugs in here. */
export type OutputCheck = (
  agent: AgentSpec,
  output: unknown,
  records: RecordRegistry,
) => { readonly ok: true } | { readonly ok: false; readonly detail: string };

// ---------------------------------------------------------------------------------------------
// Interception: decides on a tool call before it runs. The mandate guard sits here, in front
// of pay(). pay() checks the guard again itself, so this is the visible layer, not the only one.

export type ToolCall = {
  readonly agent: string;
  readonly loopId: string;
  readonly tool: string;
  /** Already parsed with the tool's input schema. */
  readonly input: unknown;
};

export type InterceptDecision =
  { readonly allow: true } | { readonly allow: false; readonly reason: string };

export type ToolInterceptor = {
  readonly name: string;
  matches(call: ToolCall): boolean;
  /** Throwing blocks the call: interception fails closed. */
  decide(call: ToolCall): Promise<InterceptDecision>;
};

// ---------------------------------------------------------------------------------------------
// The runtime

/** Our events (core/events) all have a string `type`; the runtime needs nothing more. */
export type RuntimeEvent = { readonly type: string };

export type EventOf<E extends RuntimeEvent, T extends E['type']> = Extract<E, { type: T }>;

export type Reaction<E extends RuntimeEvent, O> = {
  /** The message the agent's loop starts with, or undefined to ignore this event. */
  message(event: E): string | undefined;
  /** Called when the loop ends, typically to publish the agent's verdict. */
  done(result: LoopResult<O>, event: E): void;
};

export type Runtime<E extends RuntimeEvent = RuntimeEvent, S = unknown> = {
  readonly sessionId: string;
  /** Shared session state: mandate, offers, verdicts, budget, wallet status. */
  readonly state: S;
  readonly records: RecordRegistry;

  /** Starts an agent loop and returns at once. Start several, then await their `done`. */
  start<O>(agent: AgentSpec<O>, message: string): LoopHandle<O>;

  /**
   * A situation handler: the agent starts a loop each time an event of this type appears,
   * without anyone calling it (the deal verifier and merchant risk on offer.found).
   */
  react<T extends E['type'], O>(
    agent: AgentSpec<O>,
    type: T,
    reaction: Reaction<EventOf<E, T>, O>,
  ): void;

  /** Publishes an event to every handler and appends it to the run log. */
  publish(event: E): void;

  /** Watches events without being an agent (terminal output, SSE, the eval). */
  observe(type: E['type'] | '*', listener: (event: E) => void): void;

  intercept(interceptor: ToolInterceptor): void;

  /** Resolves once no loop is running, including loops started by reactions. */
  idle(): Promise<void>;
};
