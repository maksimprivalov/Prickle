import { describe, expect, it } from 'vitest';
import { ModelMessageItem, type GeminiGenerateContent } from '@mozaik-ai/core';
import {
  createGeminiSafeRunner,
  keepThoughtSignatures,
  retryWhenBusy,
} from './gemini-thought-signatures';

type Mapper = GeminiGenerateContent['endpointMapper'];

/** Stands in for Mozaik's mapper: echoes the call id back in the next request, as Mozaik does. */
function fakeMapper(seen: { callId?: string }): Mapper {
  return {
    toResponse(response: {
      candidates: { content: { parts: { functionCall: { id: string } }[] } }[];
    }) {
      seen.callId = response.candidates[0]?.content.parts[0]?.functionCall.id;
      return {
        items: [ModelMessageItem.rehydrate({ text: '' })],
        tokenUsage: undefined,
        rowResponse: response,
      };
    },
    toRequest: () => ({
      model: 'gemini-3.5-flash',
      contents: [
        { role: 'user', parts: [{ text: 'find a TV' }] },
        {
          role: 'model',
          parts: [{ functionCall: { id: seen.callId, name: 'search_catalog', args: {} } }],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { id: seen.callId, name: 'search_catalog' } }],
        },
      ],
    }),
  };
}

const geminiResponse = (call: Record<string, unknown>) => ({
  candidates: [
    {
      content: {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'search_catalog', args: {}, ...call },
            thoughtSignature: 'sig-1',
          },
        ],
      },
    },
  ],
});

describe('keepThoughtSignatures', () => {
  it('puts the signature from a response back on that call in the next request', () => {
    const seen: { callId?: string } = {};
    const mapper = keepThoughtSignatures(fakeMapper(seen));
    mapper.toResponse(geminiResponse({ id: 'c-1' }));
    const request = mapper.toRequest({} as never) as {
      contents: { parts: Record<string, unknown>[] }[];
    };
    expect(request.contents[1]?.parts[0]).toMatchObject({
      functionCall: { id: 'c-1' },
      thoughtSignature: 'sig-1',
    });
  });

  it('gives a call without an id one, so its signature can still be found', () => {
    const seen: { callId?: string } = {};
    const mapper = keepThoughtSignatures(fakeMapper(seen));
    mapper.toResponse(geminiResponse({}));
    expect(seen.callId).toMatch(/^call-/);
    const request = mapper.toRequest({} as never) as {
      contents: { parts: Record<string, unknown>[] }[];
    };
    expect(request.contents[1]?.parts[0]).toMatchObject({ thoughtSignature: 'sig-1' });
  });

  it('leaves other parts alone', () => {
    const seen: { callId?: string } = {};
    const mapper = keepThoughtSignatures(fakeMapper(seen));
    mapper.toResponse(geminiResponse({ id: 'c-1' }));
    const request = mapper.toRequest({} as never) as {
      contents: { parts: Record<string, unknown>[] }[];
    };
    expect(request.contents[0]?.parts[0]).toEqual({ text: 'find a TV' });
    expect(request.contents[2]?.parts[0]).not.toHaveProperty('thoughtSignature');
  });
});

describe('createGeminiSafeRunner', () => {
  it('refuses a model Mozaik does not support', async () => {
    const runner = createGeminiSafeRunner();
    await expect(runner.run({ model: 'no-such-model' } as never)).rejects.toThrow(
      'Unsupported model',
    );
  });
});

describe('retryWhenBusy', () => {
  const noWait = () => Promise.resolve();

  it('retries an overloaded provider and returns the answer that comes through', async () => {
    let calls = 0;
    const answer = await retryWhenBusy(() => {
      calls++;
      return calls < 3
        ? Promise.reject(new Error('{"code":503,"status":"UNAVAILABLE"}'))
        : Promise.resolve('ok');
    }, noWait);
    expect(answer).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after three retries', async () => {
    let calls = 0;
    const always503 = () => {
      calls++;
      return Promise.reject(new Error('503 UNAVAILABLE'));
    };
    await expect(retryWhenBusy(always503, noWait)).rejects.toThrow('503');
    expect(calls).toBe(4);
  });

  it('does not retry a real error', async () => {
    let calls = 0;
    const badRequest = () => {
      calls++;
      return Promise.reject(new Error('400 INVALID_ARGUMENT'));
    };
    await expect(retryWhenBusy(badRequest, noWait)).rejects.toThrow('400');
    expect(calls).toBe(1);
  });
});
