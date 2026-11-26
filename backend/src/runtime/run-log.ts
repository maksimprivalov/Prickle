import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { LoopFailure } from './port';

// The run log is the only source for the spend report, the eval and the concurrency timing
// table. One JSON object per line, append-only, in the order things happened.

const base = { seq: z.int().nonnegative(), at: z.iso.datetime(), sessionId: z.string() };
const loop = { ...base, agent: z.string(), loopId: z.string() };

export const RunLogLine = z.discriminatedUnion('kind', [
  /** A domain event from core/events, written as published. Parse it with the contracts. */
  z.object({ ...base, kind: z.literal('event'), event: z.unknown() }),
  z.object({ ...loop, kind: z.literal('loop.started') }),
  z.object({
    ...loop,
    kind: z.literal('loop.finished'),
    outcome: z.enum(['ok', ...Object.values(LoopFailure)]),
    /** Empty when the outcome is ok. */
    detail: z.string(),
  }),
  z.object({ ...loop, kind: z.literal('tool.called'), tool: z.string() }),
  z.object({ ...loop, kind: z.literal('tool.returned'), tool: z.string(), ok: z.boolean() }),
  z.object({
    ...loop,
    kind: z.literal('tool.blocked'),
    tool: z.string(),
    interceptor: z.string(),
    reason: z.string(),
  }),
  /** A reaction or observer threw. The run continues; the failure is on the record. */
  z.object({ ...base, kind: z.literal('handler.failed'), detail: z.string() }),
]);
export type RunLogLine = z.infer<typeof RunLogLine>;

export type RunLog = { append(line: RunLogLine): void };

export type MemoryRunLog = RunLog & { lines(): readonly RunLogLine[] };

export function createMemoryRunLog(): MemoryRunLog {
  const lines: RunLogLine[] = [];
  return {
    append: (line) => {
      lines.push(line);
    },
    lines: () => [...lines],
  };
}

/** Appends to runs/<session>.jsonl. Synchronous, so lines land in the order they happened. */
export function createJsonlRunLog(path: string): RunLog {
  mkdirSync(dirname(path), { recursive: true });
  return {
    append: (line) => {
      appendFileSync(path, `${JSON.stringify(line)}\n`, 'utf8');
    },
  };
}

/** Writes every line to several logs, e.g. the JSONL file and memory for SSE replay. */
export function teeRunLog(...logs: readonly RunLog[]): RunLog {
  return {
    append: (line) => {
      for (const log of logs) log.append(line);
    },
  };
}
