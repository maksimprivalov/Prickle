import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { DEMO_LATENCY_MS, createMockStoresApp, type MockStoresOptions } from './app';
import { loadFixtures } from './fixtures';

export type RunningStores = {
  /** e.g. http://127.0.0.1:8790 — the tools' StoreClient points here. */
  readonly baseUrl: string;
  close(): Promise<void>;
};

/**
 * Starts the mock stores on localhost. Port 0 picks a free port, so `pnpm demo` can start them
 * in-process without clashing with anything.
 */
export async function startMockStores(
  options: { port?: number; latencyMs?: MockStoresOptions['latencyMs'] } = {},
): Promise<RunningStores> {
  const app = createMockStoresApp({
    fixtures: await loadFixtures(),
    latencyMs: options.latencyMs ?? DEMO_LATENCY_MS,
  });
  return new Promise((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: options.port ?? 0, hostname: '127.0.0.1' },
      (info: AddressInfo) => {
        resolve({
          baseUrl: `http://127.0.0.1:${info.port}`,
          close: () =>
            new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
        });
      },
    );
  });
}
