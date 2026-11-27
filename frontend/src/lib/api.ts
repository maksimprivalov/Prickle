import { z } from 'zod';
import type { Mandate } from '@prickle/backend/contracts';

// The only fetch in the app. Relative URLs: Vite proxies /api to the session server.

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const Started = z.object({ sessionId: z.string().min(1) });
const ErrorBody = z.object({ error: z.string().min(1) });

export function sessionEventsPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/events`;
}

/** POST the mandate; resolves to the new session's id, or throws an ApiError. */
export async function startSession(mandate: Mandate): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mandate),
    });
  } catch {
    throw new ApiError(
      0,
      'The Prickle server is not reachable. Is `pnpm dev` running in backend/?',
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error : `The server answered ${response.status}.`,
    );
  }
  const parsed = Started.safeParse(body);
  if (!parsed.success) throw new ApiError(response.status, 'The server sent no session id.');
  return parsed.data.sessionId;
}
