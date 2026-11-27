import { describe, expect, it } from 'vitest';
import sampleRun from '@test/fixtures/sample-run.jsonl?raw';
import { replay, runLogMessages } from '@test/run-log';
import { initialStream, parseStreamMessage, StreamState, streamReducer } from './stream';

const messages = runLogMessages(sampleRun);

describe('parseStreamMessage', () => {
  it('parses every event of the recorded run', () => {
    for (const message of messages) expect(parseStreamMessage(message.data).ok).toBe(true);
  });

  it('skips non-JSON, unknown event types and invalid events instead of throwing', () => {
    expect(parseStreamMessage('not json')).toMatchObject({ ok: false, reason: 'not-json' });
    const unknown = JSON.stringify({
      sessionId: 's',
      at: '2026-11-27T10:00:00.000Z',
      agent: 'x',
      type: 'offer.lost',
    });
    expect(parseStreamMessage(unknown)).toMatchObject({ ok: false, reason: 'not-an-event' });
    const [first] = messages;
    if (!first) throw new Error('empty fixture');
    const floatPrice = first.data.replace('"maxTotal":60000', '"maxTotal":600.5');
    expect(parseStreamMessage(floatPrice)).toMatchObject({ ok: false, reason: 'not-an-event' });
  });
});

describe('streamReducer', () => {
  it('ends on session.ended', () => {
    const model = replay(messages);
    expect(model.events).toHaveLength(messages.length);
    expect(model.state).toBe(StreamState.Ended);
  });

  it('dedupes the replay a reconnect delivers', () => {
    const half = messages.slice(0, 20);
    const reconnected = replay(
      messages,
      replay(half, streamReducer(initialStream, { type: 'reset' })),
    );
    expect(reconnected.events).toHaveLength(messages.length);
  });
});
