import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

// One MSW server for the tests that touch the network; unhandled requests fail the test.
export const server = setupServer();

export function setupMswServer(): void {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
