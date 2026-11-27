import { z } from 'zod';
import {
  initialStream,
  parseStreamMessage,
  streamReducer,
  type StreamModel,
} from '@features/session';

// Replays a recorded run log (copied from backend/runs/) the way the SSE stream delivers it:
// one message per event, data = the event as JSON, id = the run-log sequence number.

const Line = z.object({ kind: z.string(), seq: z.number(), event: z.unknown().optional() });

export type StreamMessage = { id: string; data: string };

export function runLogMessages(raw: string): StreamMessage[] {
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => Line.parse(JSON.parse(line)))
    .filter((line) => line.kind === 'event')
    .map((line) => ({ id: String(line.seq), data: JSON.stringify(line.event) }));
}

export function replay(
  messages: readonly StreamMessage[],
  from: StreamModel = initialStream,
): StreamModel {
  return messages.reduce((model, message) => {
    const parsed = parseStreamMessage(message.data);
    if (!parsed.ok)
      throw new Error(`Fixture message ${message.id} did not parse: ${parsed.detail}`);
    return streamReducer(model, { type: 'event', id: message.id, event: parsed.event });
  }, from);
}
