import { useEffect, useReducer } from 'react';
import { sessionEventsPath } from '@lib/api';
import { initialStream, parseStreamMessage, StreamState, streamReducer } from './stream';

/** Follows one session's event stream; the server replays it from the start. */
export function useSessionEvents(sessionId: string | undefined) {
  const [model, dispatch] = useReducer(streamReducer, initialStream);

  useEffect(() => {
    if (!sessionId) return;
    dispatch({ type: 'reset' });
    // Resolved against the page so it works the same under the Vite proxy and in tests.
    const source = new EventSource(new URL(sessionEventsPath(sessionId), window.location.href));
    let warned = false;

    source.onopen = () => dispatch({ type: 'state', state: StreamState.Open });
    source.onmessage = (message: MessageEvent<string>) => {
      const parsed = parseStreamMessage(message.data);
      if (!parsed.ok) {
        if (!warned) console.warn(`Skipped a stream message (${parsed.reason}):`, parsed.detail);
        warned = true;
        return;
      }
      dispatch({ type: 'event', id: message.lastEventId, event: parsed.event });
      // The session is over: close before the server does, so EventSource does not retry.
      if (parsed.event.type === 'session.ended') source.close();
    };
    source.onerror = () => {
      dispatch({
        type: 'state',
        state:
          source.readyState === EventSource.CLOSED ? StreamState.Failed : StreamState.Reconnecting,
      });
    };

    return () => source.close();
  }, [sessionId]);

  return model;
}
