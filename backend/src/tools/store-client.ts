// How tools reach the mock stores: over HTTP in the demo, or straight into the Hono app in tests
// (`fetch: (url, init) => app.request(url, init)`), with no network either way in `pnpm test`.

export type StoreClient = {
  /** e.g. http://127.0.0.1:8790, from startMockStores(). */
  readonly baseUrl: string;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
};

/** A store that is down, answers with an error or answers in a shape we cannot read. */
export class StoreError extends Error {}

async function call(client: StoreClient, path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await client.fetch(`${client.baseUrl}${path}`, init);
  } catch (error) {
    throw new StoreError(`store unreachable at ${path}: ${String(error)}`);
  }
  if (!response.ok) throw new StoreError(`store answered ${response.status} at ${path}`);
  return response;
}

export async function getJson(client: StoreClient, path: string): Promise<unknown> {
  const response = await call(client, path);
  try {
    return await response.json();
  } catch {
    throw new StoreError(`store sent something that is not JSON at ${path}`);
  }
}

export async function postJson(client: StoreClient, path: string, body: unknown): Promise<unknown> {
  const response = await call(client, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    return await response.json();
  } catch {
    throw new StoreError(`store sent something that is not JSON at ${path}`);
  }
}

export async function getText(client: StoreClient, path: string): Promise<string> {
  return (await call(client, path)).text();
}
