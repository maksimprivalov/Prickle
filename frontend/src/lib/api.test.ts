import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Mandate } from '@prickle/backend/contracts';
import { server, setupMswServer } from '@test/msw';
import { ApiError, startSession } from './api';

setupMswServer();

const mandate: Mandate = {
  description: '55-inch TV',
  category: 'tv',
  screenInches: 55,
  maxTotal: 60000 as Mandate['maxTotal'],
  requireRealDiscount: true,
  trustedStoresOnly: true,
};

describe('startSession()', () => {
  it('returns the session id and says when the server is replaying a recorded run', async () => {
    server.use(
      http.post('/api/sessions', () =>
        HttpResponse.json({ sessionId: 'replay-1', mode: 'replay' }, { status: 201 }),
      ),
    );
    expect(await startSession(mandate)).toEqual({ sessionId: 'replay-1', mode: 'replay' });
  });

  it('treats a server that sends no mode as live', async () => {
    server.use(
      http.post('/api/sessions', () => HttpResponse.json({ sessionId: 's-1' }, { status: 201 })),
    );
    expect(await startSession(mandate)).toEqual({ sessionId: 's-1', mode: 'live' });
  });

  it('throws the server message when a session is already running', async () => {
    server.use(
      http.post('/api/sessions', () =>
        HttpResponse.json({ error: 'A session is already running.' }, { status: 409 }),
      ),
    );
    await expect(startSession(mandate)).rejects.toEqual(
      new ApiError(409, 'A session is already running.'),
    );
  });
});
