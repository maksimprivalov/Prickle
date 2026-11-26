import { z } from 'zod';
import type {
  AgentSpec,
  InterceptDecision,
  LoopResult,
  OutputCheck,
  RecordRegistry,
  ToolCall,
  ToolInterceptor,
  ToolSpec,
} from './port';
import { LoopFailure } from './port';
import type { RunLog, RunLogLine } from './run-log';

// What both adapters do the same way, so a tool call, a blocked payment or a rejected answer
// behaves identically on Mozaik and on plain promises.

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type LogEntry = DistributiveOmit<RunLogLine, 'seq' | 'at' | 'sessionId'>;
export type LogWriter = (entry: LogEntry) => void;

export function createLogWriter(log: RunLog, sessionId: string, clock: () => Date): LogWriter {
  let seq = 0;
  return (entry) => {
    log.append({ ...entry, seq: seq++, at: clock().toISOString(), sessionId });
  };
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type ToolInputResult =
  | { readonly ok: true; readonly input: unknown }
  | { readonly ok: false; readonly output: { readonly error: string } };

export function parseToolInput(tool: ToolSpec, raw: unknown): ToolInputResult {
  const parsed = tool.input.safeParse(raw);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : {
        ok: false,
        output: { error: `invalid input for ${tool.name}: ${z.prettifyError(parsed.error)}` },
      };
}

export type BlockedOutput = { readonly blocked: true; readonly reason: string };

/** Asks every matching interceptor; the first block wins. Throwing blocks (fail closed). */
export async function decideToolCall(
  interceptors: readonly ToolInterceptor[],
  call: ToolCall,
): Promise<{ readonly by: string; readonly decision: InterceptDecision }> {
  for (const interceptor of interceptors) {
    try {
      if (!interceptor.matches(call)) continue;
      const decision = await interceptor.decide(call);
      if (!decision.allow) return { by: interceptor.name, decision };
    } catch (error) {
      return {
        by: interceptor.name,
        decision: { allow: false, reason: `interceptor failed: ${messageOf(error)}` },
      };
    }
  }
  return { by: '', decision: { allow: true } };
}

export function matchesAny(interceptors: readonly ToolInterceptor[], call: ToolCall): boolean {
  // An interceptor whose `matches` throws is treated as matching, so `decide` blocks the call.
  return interceptors.some((interceptor) => {
    try {
      return interceptor.matches(call);
    } catch {
      return true;
    }
  });
}

/** Runs an already parsed and allowed tool call. Never throws: failures become tool output. */
export async function invokeTool(
  tool: ToolSpec,
  input: unknown,
  at: {
    readonly sessionId: string;
    readonly agent: string;
    readonly loopId: string;
    readonly records: RecordRegistry;
    readonly write: LogWriter;
  },
): Promise<unknown> {
  const where = { agent: at.agent, loopId: at.loopId, tool: tool.name };
  at.write({ kind: 'tool.called', ...where });
  try {
    const output = tool.output.parse(
      await tool.run(input, { sessionId: at.sessionId, agent: at.agent, records: at.records }),
    );
    at.write({ kind: 'tool.returned', ...where, ok: true });
    return output;
  } catch (error) {
    at.write({ kind: 'tool.returned', ...where, ok: false });
    return { error: `${tool.name} failed: ${messageOf(error)}` };
  }
}

/** Parses the final answer with the agent's schema, then runs the output check. */
export function settleAnswer<O>(
  agent: AgentSpec<O>,
  answer: unknown,
  checkOutput: OutputCheck | undefined,
  records: RecordRegistry,
): LoopResult<O> {
  const parsed = agent.output.safeParse(answer);
  if (!parsed.success) {
    return {
      ok: false,
      reason: LoopFailure.InvalidOutput,
      detail: z.prettifyError(parsed.error),
    };
  }
  if (checkOutput) {
    try {
      const check = checkOutput(agent, parsed.data, records);
      if (!check.ok) return { ok: false, reason: LoopFailure.Rejected, detail: check.detail };
    } catch (error) {
      return {
        ok: false,
        reason: LoopFailure.Rejected,
        detail: `output check failed: ${messageOf(error)}`,
      };
    }
  }
  return { ok: true, output: parsed.data };
}

export function logLoopFinished(
  write: LogWriter,
  agent: string,
  loopId: string,
  result: LoopResult<unknown>,
): void {
  write({
    kind: 'loop.finished',
    agent,
    loopId,
    outcome: result.ok ? 'ok' : result.reason,
    detail: result.ok ? '' : result.detail,
  });
}

/** Tracks running loops (and the reactions they trigger) so `idle()` can wait for all. */
export function createLoopTracker() {
  const active = new Set<Promise<unknown>>();
  return {
    track(promise: Promise<unknown>): void {
      active.add(promise);
      const remove = () => active.delete(promise);
      promise.then(remove, remove);
    },
    async idle(): Promise<void> {
      // A finishing loop can start new ones through reactions, so wait until none are left.
      while (active.size > 0) await Promise.allSettled([...active]);
    },
  };
}

/** Per-agent loop numbering: "deal-verifier#1", "deal-verifier#2", … */
export function createLoopIds() {
  const counts = new Map<string, number>();
  return (agent: string): string => {
    const n = (counts.get(agent) ?? 0) + 1;
    counts.set(agent, n);
    return `${agent}#${n}`;
  };
}

/** Runs a listener or reaction step; a throw is logged instead of breaking the fan-out. */
export function guarded(write: LogWriter, run: () => void): void {
  try {
    run();
  } catch (error) {
    write({ kind: 'handler.failed', detail: messageOf(error) });
  }
}
