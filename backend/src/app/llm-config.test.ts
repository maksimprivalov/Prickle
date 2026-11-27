import { describe, expect, it } from 'vitest';
import { LlmEnv, geminiKeys, llmRuntimeOptions, requestsPerMinute } from './llm-config';

const env = (raw: Record<string, string>) => LlmEnv.parse(raw);

describe('geminiKeys', () => {
  it('reads GEMINI_API_KEY, then the numbered ones in number order', () => {
    expect(
      geminiKeys({
        GEMINI_API_KEY_10: 'test-key-10',
        GEMINI_API_KEY: 'test-key-1',
        GEMINI_API_KEY_2: 'test-key-2',
      }),
    ).toEqual(['test-key-1', 'test-key-2', 'test-key-10']);
  });

  it('skips empty keys and a key given twice', () => {
    expect(
      geminiKeys({
        GEMINI_API_KEY: 'test-key',
        GEMINI_API_KEY_2: 'test-key',
        GEMINI_API_KEY_3: ' ',
      }),
    ).toEqual(['test-key']);
  });

  it('ignores names that only look alike', () => {
    expect(geminiKeys({ GEMINI_API_KEY_X: 'test-key', MY_GEMINI_API_KEY_2: 'test-key' })).toEqual(
      [],
    );
  });
});

describe('requestsPerMinute', () => {
  const free = env({ GEMINI_API_KEY: 'test-key' });

  it("stays one under each model's free-tier limit by default", () => {
    expect(requestsPerMinute(free, 'gemini-3.5-flash-lite')).toBe(14);
    expect(requestsPerMinute(free, 'gemini-3.5-flash')).toBe(4);
  });

  it('gives an unknown model the strictest known limit, not none', () => {
    expect(requestsPerMinute(free, 'gemini-3.8-flash')).toBe(4);
  });

  it('uses GEMINI_REQUESTS_PER_MINUTE for every model when set, 0 meaning no limit', () => {
    const set = env({ GEMINI_API_KEY: 'test-key', GEMINI_REQUESTS_PER_MINUTE: '0' });
    expect(requestsPerMinute(set, 'gemini-3.5-flash')).toBe(0);
  });
});

describe('llmRuntimeOptions', () => {
  it('runs everything on flash-lite with one key by default (judge mode)', () => {
    const raw = { GEMINI_API_KEY: 'test-key' };
    const options = llmRuntimeOptions(env(raw), raw);
    expect(options.models).toEqual({
      fast: 'gemini-3.5-flash-lite',
      strong: 'gemini-3.5-flash-lite',
    });
    expect(options.agentModels).toEqual({ reviewer: 'gemini-3.5-flash-lite' });
    expect(options.inference).toBeDefined();
    expect(options.keyCount).toBe(1);
  });

  it('moves the reviewer to its own model when MODEL_REVIEWER is set', () => {
    const raw = { GEMINI_API_KEY: 'test-key', MODEL_REVIEWER: 'gemini-3.5-flash' };
    expect(llmRuntimeOptions(env(raw), raw).agentModels).toEqual({ reviewer: 'gemini-3.5-flash' });
  });

  it('keeps the reviewer on the strong model when the others are not Gemini', () => {
    const raw = {
      OPENAI_API_KEY: 'test-key',
      MODEL_FAST: 'gpt-5.4-nano',
      MODEL_STRONG: 'gpt-5.4-mini',
    };
    const options = llmRuntimeOptions(env(raw), raw);
    expect(options.agentModels).toEqual({ reviewer: 'gpt-5.4-mini' });
    expect(options.inference).toBeUndefined();
  });

  it('counts every Gemini key it will use', () => {
    const raw = { GEMINI_API_KEY: 'test-key-1', GEMINI_API_KEY_2: 'test-key-2' };
    expect(llmRuntimeOptions(env(raw), raw).keyCount).toBe(2);
  });

  it('refuses to start without any LLM key', () => {
    expect(LlmEnv.safeParse({}).success).toBe(false);
  });
});
