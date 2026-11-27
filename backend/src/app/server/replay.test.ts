import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PrickleEvent } from '@core/events';
import { parseRunLog } from '@app/report/concurrency';
import { createMemoryRunLog } from '@runtime/run-log';
import { REPLAY_MAX_GAP_MS, createReplayRunner } from './replay';

const sample = parseRunLog(
  readFileSync(new URL('../../../runs/sample-run.jsonl', import.meta.url), 'utf8'),
);

async function replay(speed: number) {
  const waits: number[] = [];
  const log = createMemoryRunLog();
  const run = createReplayRunner({
    lines: sample,
    speed,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  await run({ sessionId: 'web-replay-1', mandate: undefined as never, log });
  return { lines: log.lines(), waits };
}

describe('createReplayRunner()', () => {
  it('replays every line of the committed sample run, in order, under the new session id', async () => {
    const { lines } = await replay(4);
    expect(lines).toHaveLength(sample.length);
    expect(lines.map((l) => l.seq)).toEqual(sample.map((l) => l.seq));
    for (const line of lines) {
      expect(line.sessionId).toBe('web-replay-1');
      if (line.kind === 'event') {
        expect(PrickleEvent.parse(line.event).sessionId).toBe('web-replay-1');
      }
    }
  });

  it('keeps the recorded timestamps, so the timeline shows the real durations', async () => {
    const { lines } = await replay(4);
    expect(lines.map((l) => l.at)).toEqual(sample.map((l) => l.at));
  });

  it('paces by the recorded gaps divided by the speed, shortening long waits', async () => {
    const { waits } = await replay(4);
    const recorded = Date.parse(sample.at(-1)?.at ?? '') - Date.parse(sample[0]?.at ?? '');
    const total = waits.reduce((sum, w) => sum + w, 0);
    expect(total).toBeLessThanOrEqual(recorded / 4 + sample.length);
    expect(Math.max(...waits)).toBeLessThanOrEqual(REPLAY_MAX_GAP_MS);
  });

  it('ends with the same session.ended and payment as the recording', async () => {
    const { lines } = await replay(10);
    const events = lines.flatMap((l) => (l.kind === 'event' ? [PrickleEvent.parse(l.event)] : []));
    expect(events.find((e) => e.type === 'payment.settled')).toMatchObject({
      offerId: 'b-tv55',
      amount: 585_000_000,
    });
    expect(events.at(-1)?.type).toBe('session.ended');
  });
});
