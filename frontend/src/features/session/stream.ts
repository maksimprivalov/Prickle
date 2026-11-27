import { PrickleEvent } from '@prickle/backend/contracts';

// The pure half of the event stream: parse one SSE message, and fold it into the list of
// events the page is drawn from. The hook only wires these to an EventSource.

export const StreamState = {
  Idle: 'idle',
  Connecting: 'connecting',
  Open: 'open',
  Reconnecting: 'reconnecting',
  Ended: 'ended',
  Failed: 'failed',
} as const;
export type StreamState = (typeof StreamState)[keyof typeof StreamState];

export type ParsedMessage =
  | { ok: true; event: PrickleEvent }
  | { ok: false; reason: 'not-json' | 'not-an-event'; detail: string };

export function parseStreamMessage(data: string): ParsedMessage {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { ok: false, reason: 'not-json', detail: data.slice(0, 120) };
  }
  const parsed = PrickleEvent.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: 'not-an-event', detail: parsed.error.message.slice(0, 300) };
  }
  return { ok: true, event: parsed.data };
}

export type StreamModel = {
  state: StreamState;
  events: PrickleEvent[];
  /** SSE ids already applied: the server replays from the start on reconnect. */
  seen: ReadonlySet<string>;
};

export type StreamAction =
  | { type: 'reset' }
  | { type: 'state'; state: StreamState }
  | { type: 'event'; id: string; event: PrickleEvent };

export const initialStream: StreamModel = { state: StreamState.Idle, events: [], seen: new Set() };

export function streamReducer(model: StreamModel, action: StreamAction): StreamModel {
  switch (action.type) {
    case 'reset':
      return { ...initialStream, state: StreamState.Connecting };
    case 'state':
      return model.state === action.state ? model : { ...model, state: action.state };
    case 'event': {
      if (action.id !== '' && model.seen.has(action.id)) return model;
      const seen = new Set(model.seen);
      if (action.id !== '') seen.add(action.id);
      const ended = action.event.type === 'session.ended';
      return {
        state: ended ? StreamState.Ended : StreamState.Open,
        events: [...model.events, action.event],
        seen,
      };
    }
  }
}
