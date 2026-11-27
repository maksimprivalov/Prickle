import { RunLogLine } from '@runtime/run-log';

// Fix 5: the proof that agents really run at the same time, taken from the run log alone.
// The runtime writes loop.started / loop.finished for every agent loop, so wall-clock time can
// be set against the summed time of the loops: if five scouts take 3 s each and the five
// finish within 3.5 s, they ran in parallel, not one after another.

export type LoopSpan = {
  readonly agent: string;
  readonly loopId: string;
  readonly startMs: number;
  readonly endMs: number;
  /** "ok", a failure reason, or "unfinished" when the log ends first. */
  readonly outcome: string;
};

export type GroupTiming = {
  readonly label: string;
  readonly loops: number;
  /** From the first start to the last finish. */
  readonly wallMs: number;
  /** The loops' durations added up, as if they had run one after another. */
  readonly summedMs: number;
  /** The most loops of this group running at the same moment. */
  readonly peak: number;
};

export type ConcurrencyReport = {
  readonly sessionId: string | undefined;
  readonly spans: readonly LoopSpan[];
  readonly groups: readonly GroupTiming[];
};

/** Parses JSONL text; lines that are not run-log lines are skipped. */
export function parseRunLog(text: string): RunLogLine[] {
  return text.split('\n').flatMap((raw) => {
    if (raw.trim() === '') return [];
    try {
      const parsed = RunLogLine.safeParse(JSON.parse(raw));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export function loopSpans(lines: readonly RunLogLine[]): LoopSpan[] {
  const lastMs = Math.max(0, ...lines.map((l) => Date.parse(l.at)));
  const open = new Map<string, { agent: string; startMs: number }>();
  const spans: LoopSpan[] = [];
  for (const line of lines) {
    if (line.kind === 'loop.started') {
      open.set(line.loopId, { agent: line.agent, startMs: Date.parse(line.at) });
    } else if (line.kind === 'loop.finished') {
      const started = open.get(line.loopId);
      if (!started) continue;
      open.delete(line.loopId);
      spans.push({
        ...started,
        loopId: line.loopId,
        endMs: Date.parse(line.at),
        outcome: line.outcome,
      });
    }
  }
  for (const [loopId, started] of open) {
    spans.push({ ...started, loopId, endMs: lastMs, outcome: 'unfinished' });
  }
  return spans.sort((a, b) => a.startMs - b.startMs || a.loopId.localeCompare(b.loopId));
}

export function groupTiming(label: string, spans: readonly LoopSpan[]): GroupTiming {
  if (spans.length === 0) return { label, loops: 0, wallMs: 0, summedMs: 0, peak: 0 };
  const wallMs = Math.max(...spans.map((s) => s.endMs)) - Math.min(...spans.map((s) => s.startMs));
  const summedMs = spans.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  // Sweep the starts and ends in time order; an end at the same instant as a start comes first.
  const edges = spans
    .flatMap((s) => [
      { at: s.startMs, delta: 1 },
      { at: s.endMs, delta: -1 },
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  let running = 0;
  let peak = 0;
  for (const edge of edges) {
    running += edge.delta;
    peak = Math.max(peak, running);
  }
  return { label, loops: spans.length, wallMs, summedMs, peak };
}

const isScout = (agent: string) => agent.startsWith('scout-');
const CHECKERS = new Set(['deal-verifier', 'merchant-risk']);

export function concurrencyReport(lines: readonly RunLogLine[]): ConcurrencyReport {
  const spans = loopSpans(lines);
  return {
    sessionId: lines[0]?.sessionId,
    spans,
    groups: [
      groupTiming(
        '5 scouts',
        spans.filter((s) => isScout(s.agent)),
      ),
      groupTiming(
        'Checkers on all offers',
        spans.filter((s) => CHECKERS.has(s.agent)),
      ),
      groupTiming('All agent loops', spans),
    ],
  };
}

/** Milliseconds as seconds with one decimal: 3480 -> "3.4 s". */
export function seconds(ms: number): string {
  const tenths = Math.floor(ms / 100);
  return `${Math.floor(tenths / 10)}.${tenths % 10} s`;
}

/** How many times longer one after another would have taken: summed / wall, one decimal. */
export function speedup(group: GroupTiming): string {
  if (group.wallMs === 0) return '—';
  const tenths = Math.floor((group.summedMs * 10) / group.wallMs);
  return `${Math.floor(tenths / 10)}.${tenths % 10}×`;
}

/** The README table: wall-clock against summed time, per group. */
export function timingTable(report: ConcurrencyReport): string {
  const rows = report.groups
    .filter((g) => g.loops > 0)
    .map(
      (g) =>
        `| ${g.label} | ${g.loops} | ${seconds(g.wallMs)} | ${seconds(g.summedMs)} | ${speedup(g)} | ${g.peak} |`,
    );
  return [
    '| | Loops | Wall-clock | Sum of individual times | Sum ÷ wall | Most at once |',
    '| --- | --: | --: | --: | --: | --: |',
    ...rows,
  ].join('\n');
}

/** One lane per loop, scaled to `width` characters: the parallel timeline in a terminal. */
export function timelineLanes(report: ConcurrencyReport, width = 50): string[] {
  const { spans } = report;
  if (spans.length === 0) return [];
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const t1 = Math.max(...spans.map((s) => s.endMs));
  const scale = (ms: number) => (t1 === t0 ? 0 : Math.round(((ms - t0) * width) / (t1 - t0)));
  const nameWidth = Math.max(...spans.map((s) => s.loopId.length));
  return spans.map((s) => {
    const from = scale(s.startMs);
    const to = Math.max(from + 1, scale(s.endMs));
    const bar = ' '.repeat(from) + '█'.repeat(to - from) + ' '.repeat(Math.max(0, width - to));
    const mark = s.outcome === 'ok' ? '' : `  ${s.outcome}`;
    return `${s.loopId.padEnd(nameWidth)} |${bar}| ${seconds(s.endMs - s.startMs)}${mark}`;
  });
}
