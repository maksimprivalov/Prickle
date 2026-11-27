import { describe, expect, it } from 'vitest';
import type { RunLogLine } from '@runtime/run-log';
import {
  concurrencyReport,
  groupTiming,
  loopSpans,
  parseRunLog,
  seconds,
  speedup,
  timelineLanes,
  timingTable,
} from './concurrency';

const t = (ms: number) => new Date(Date.UTC(2026, 10, 27, 10, 0, 0) + ms).toISOString();
let seq = 0;
const started = (agent: string, ms: number, n = 1): RunLogLine => ({
  kind: 'loop.started',
  seq: seq++,
  at: t(ms),
  sessionId: 's-1',
  agent,
  loopId: `${agent}#${n}`,
});
const finished = (
  agent: string,
  ms: number,
  n = 1,
  outcome: 'ok' | 'failed' = 'ok',
): RunLogLine => ({
  kind: 'loop.finished',
  seq: seq++,
  at: t(ms),
  sessionId: 's-1',
  agent,
  loopId: `${agent}#${n}`,
  outcome,
  detail: '',
});

// Five scouts started together, 2–3 s each; two deal-verifier loops after them.
const lines: RunLogLine[] = [
  ...['a', 'b', 'c', 'd', 'e'].map((s, i) => started(`scout-${s}`, i * 10)),
  finished('scout-a', 2000),
  finished('scout-b', 2500),
  started('deal-verifier', 2100, 1),
  finished('scout-c', 3000),
  finished('scout-d', 2800),
  finished('scout-e', 3040),
  started('deal-verifier', 2600, 2),
  finished('deal-verifier', 5100, 1),
  finished('deal-verifier', 5600, 2, 'failed'),
];

describe('concurrencyReport()', () => {
  it("sets the scouts' wall-clock time against their summed time", () => {
    const [scouts] = concurrencyReport(lines).groups;
    expect(scouts).toEqual({
      label: '5 scouts',
      loops: 5,
      wallMs: 3040,
      summedMs: 2000 + 2490 + 2980 + 2770 + 3000,
      peak: 5,
    });
    expect(speedup(scouts ?? groupTiming('x', []))).toBe('4.3×');
  });

  it('counts the checkers separately, including a failed loop', () => {
    const checkers = concurrencyReport(lines).groups[1];
    expect(checkers).toMatchObject({ loops: 2, wallMs: 3500, summedMs: 6000, peak: 2 });
  });

  it('shows one after another as 1.0× and a peak of 1', () => {
    const serial = [
      started('scout-a', 0),
      finished('scout-a', 1000),
      started('scout-b', 1000),
      finished('scout-b', 2000),
    ];
    const [g] = concurrencyReport(serial).groups;
    expect(g).toMatchObject({ wallMs: 2000, summedMs: 2000, peak: 1 });
    expect(speedup(g ?? groupTiming('x', []))).toBe('1.0×');
  });

  it('closes a loop that never finished at the last line of the log', () => {
    const spans = loopSpans([
      started('scout-c', 0),
      finished('scout-a', 4000),
      started('scout-a', 10),
    ]);
    expect(spans.find((s) => s.agent === 'scout-c')).toMatchObject({
      endMs: Date.parse(t(4000)),
      outcome: 'unfinished',
    });
  });
});

describe('formatting', () => {
  it('writes seconds with one decimal, without rounding up', () => {
    expect(seconds(3040)).toBe('3.0 s');
    expect(seconds(99)).toBe('0.0 s');
    expect(seconds(12_999)).toBe('12.9 s');
  });

  it('renders the README table, skipping empty groups', () => {
    const table = timingTable(
      concurrencyReport(lines.filter((l) => 'agent' in l && l.agent.startsWith('scout-'))),
    );
    expect(table.split('\n')).toEqual([
      '| | Loops | Wall-clock | Sum of individual times | Sum ÷ wall | Most at once |',
      '| --- | --: | --: | --: | --: | --: |',
      '| 5 scouts | 5 | 3.0 s | 13.2 s | 4.3× | 5 |',
      '| All agent loops | 5 | 3.0 s | 13.2 s | 4.3× | 5 |',
    ]);
  });

  it('draws one lane per loop, marking failures', () => {
    const lanes = timelineLanes(concurrencyReport(lines), 20);
    expect(lanes).toHaveLength(7);
    expect(lanes.at(-1)).toContain('failed');
    expect(lanes[0]).toMatch(/^scout-a#1\s+\|█+\s*\| 2\.0 s$/);
  });
});

describe('parseRunLog()', () => {
  it('reads JSONL and skips lines that are not run-log lines', () => {
    const text = [JSON.stringify(lines[0]), 'not json', JSON.stringify({ kind: 'nope' }), ''].join(
      '\n',
    );
    expect(parseRunLog(text)).toEqual([lines[0]]);
  });
});
