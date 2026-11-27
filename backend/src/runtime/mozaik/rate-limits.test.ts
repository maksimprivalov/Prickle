import { describe, expect, it } from 'vitest';
import { createStickyPicker, retryDelayMs, retryWhenBusy } from './gemini-thought-signatures';
import { createRequestLimiter } from './request-limiter';

// A fake clock: sleep() moves time forward instead of waiting.
function fakeTime() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: (ms: number) => {
      slept.push(ms);
      t += ms;
      return Promise.resolve();
    },
    slept,
    at: () => t,
  };
}

describe('createRequestLimiter()', () => {
  it('lets the first N calls of a minute through at once', async () => {
    const time = fakeTime();
    const limiter = createRequestLimiter({ perMinute: 3, ...time });
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(time.slept).toEqual([]);
  });

  it('makes the next call wait until the oldest one is a minute old', async () => {
    const time = fakeTime();
    const limiter = createRequestLimiter({ perMinute: 2, ...time });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(time.at()).toBeGreaterThanOrEqual(60_000);
    expect(time.at()).toBeLessThan(61_000);
  });

  it('never lets more than N calls start within any minute', async () => {
    const time = fakeTime();
    const limiter = createRequestLimiter({ perMinute: 14, ...time });
    const starts: number[] = [];
    // About one demo session: 25 calls asked for at once.
    await Promise.all(
      Array.from({ length: 25 }, async () => {
        await limiter.acquire();
        starts.push(time.now());
      }),
    );
    for (const start of starts) {
      expect(starts.filter((s) => s >= start && s < start + 60_000).length).toBeLessThanOrEqual(14);
    }
    expect(starts).toHaveLength(25);
  });

  it('does nothing when turned off', async () => {
    const time = fakeTime();
    const limiter = createRequestLimiter({ perMinute: 0, ...time });
    await Promise.all(Array.from({ length: 100 }, () => limiter.acquire()));
    expect(time.slept).toEqual([]);
  });
});

describe('retryDelayMs()', () => {
  it('reads Gemini\'s "Please retry in 2.3s"', () => {
    expect(retryDelayMs('Quota exceeded … Please retry in 2.300358913s.')).toBe(2301);
  });

  it('reads the retryDelay field', () => {
    expect(retryDelayMs('{"@type":"…RetryInfo","retryDelay":"17s"}')).toBe(17_000);
  });

  it('returns undefined when the error names no delay', () => {
    expect(retryDelayMs('503 UNAVAILABLE')).toBeUndefined();
  });
});

describe("retryWhenBusy() and the provider's delay", () => {
  it('waits at least as long as a 429 asks, plus a margin', async () => {
    const waits: number[] = [];
    let calls = 0;
    const answer = await retryWhenBusy(
      () => {
        calls++;
        return calls === 1
          ? Promise.reject(
              new Error('{"code":429,"status":"RESOURCE_EXHAUSTED"} Please retry in 20s.'),
            )
          : Promise.resolve('ok');
      },
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );
    expect(answer).toBe('ok');
    expect(waits).toEqual([20_500]);
  });

  it('never waits more than a minute for one retry', async () => {
    const waits: number[] = [];
    await retryWhenBusy(
      (() => {
        let first = true;
        return () => {
          if (!first) return Promise.resolve('ok');
          first = false;
          return Promise.reject(new Error('429 Please retry in 600s'));
        };
      })(),
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );
    expect(waits).toEqual([60_000]);
  });
});

describe('createStickyPicker()', () => {
  it('keeps one loop on one key for its whole life', () => {
    const pick = createStickyPicker(['key-a', 'key-b'] as const);
    const first = pick('loop-1');
    expect([pick('loop-1'), pick('loop-1')]).toEqual([first, first]);
  });

  it('spreads new loops over the keys in turn', () => {
    const pick = createStickyPicker(['key-a', 'key-b'] as const);
    expect(['loop-1', 'loop-2', 'loop-3', 'loop-4'].map(pick)).toEqual([
      'key-a',
      'key-b',
      'key-a',
      'key-b',
    ]);
  });

  it('with one key, gives every loop that key', () => {
    const pick = createStickyPicker(['key-a'] as const);
    expect(['loop-1', 'loop-2'].map(pick)).toEqual(['key-a', 'key-a']);
  });
});
