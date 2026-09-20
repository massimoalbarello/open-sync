import { expect, test } from 'bun:test';
import type { Delivery } from '@context-use/open-sync/delivery';
import { httpDestination } from '@open-sync/examples/destinations/http';
import { destinationCredentials } from '#backend/lib/destination-credentials.ts';

const owner = { actorId: 'alice', ownerId: 'alice' };
const delivery: Delivery = {
  version: 1,
  id: 'delivery-1',
  ownerId: owner.ownerId,
  sourceId: 'source-1',
  installationId: 'sync-1',
  definition: { id: 'example', version: '1', artifactId: 'example/1' },
  deliverable: {
    records: [
      {
        operation: 'upsert',
        kind: 'meeting',
        id: 'meeting-1',
        data: { title: 'Planning' },
        revision: 1,
        eventId: 'event-1',
        contentHash: 'hash',
      },
    ],
  },
};

test('HTTP deliveries authenticate, retain idempotency on retry and never follow redirects', async () => {
  const endpoint = 'https://receiver.example/records';
  const credentials = destinationCredentials('test-host-secret');
  const credential = credentials.seal({
    ownerId: owner.ownerId,
    endpoint,
    apiKey: 'user-provided-key',
  });
  const received: { authorization: string | null; id: string | null; body: unknown }[] = [];
  let mode: 'retry' | 'redirect' | 'reject' | 'accept' = 'retry';
  let forwarded = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === '/other') {
        forwarded = true;
      }
      received.push({
        authorization: request.headers.get('authorization'),
        id: request.headers.get('idempotency-key'),
        body: await request.json(),
      });
      switch (mode) {
        case 'retry':
          return new Response(null, { status: 429, headers: { 'retry-after': '2' } });
        case 'redirect':
          return new Response(null, { status: 307, headers: { location: '/other' } });
        case 'reject':
          return new Response(null, { status: 401 });
        default:
          return new Response(null, { status: 204 });
      }
    },
  });
  const destination = httpDestination({
    resolveApiKey: credentials.open,
    fetch: Object.assign(
      (...[url, init]: Parameters<typeof fetch>) => {
        expect(String(url)).toBe(endpoint);
        return fetch(new URL('/records', server.url), init);
      },
      { preconnect: fetch.preconnect },
    ),
  });
  const input = {
    scope: owner,
    config: { endpoint, credential },
    delivery,
    signal: new AbortController().signal,
  };
  try {
    expect(await destination.deliver(input)).toEqual({
      status: 'retry',
      retryAfterMs: 2000,
      code: 'http_429',
    });
    mode = 'accept';
    expect(await destination.deliver(input)).toEqual({ status: 'accepted' });
    expect(received).toEqual([
      { authorization: 'Bearer user-provided-key', id: delivery.id, body: delivery },
      { authorization: 'Bearer user-provided-key', id: delivery.id, body: delivery },
    ]);
    mode = 'redirect';
    expect(await destination.deliver(input)).toEqual({ status: 'rejected', code: 'http_307' });
    expect(forwarded).toBe(false);
    mode = 'reject';
    expect(await destination.deliver(input)).toEqual({ status: 'rejected', code: 'http_401' });
    expect(JSON.stringify(input.config)).not.toContain('user-provided-key');
    const requests = received.length;
    expect(
      await destination.deliver({ ...input, scope: { actorId: 'bob', ownerId: 'bob' } }),
    ).toEqual({ status: 'rejected', code: 'owner_mismatch' });
    await expect(
      destination.deliver({
        ...input,
        config: { ...input.config, endpoint: 'http://receiver.example/records' },
      }),
    ).rejects.toThrow();
    expect(received).toHaveLength(requests);
  } finally {
    await server.stop(true);
  }
});

test('destination keys remain decryptable after restart and are bound to owner and endpoint', () => {
  const input = {
    ownerId: 'alice',
    endpoint: 'https://receiver.example/records',
    apiKey: 'secret-key',
  };
  const credential = destinationCredentials('stable-host-secret').seal(input);
  const restarted = destinationCredentials('stable-host-secret');
  expect(restarted.open({ ...input, credential })).toBe(input.apiKey);
  expect(() => restarted.open({ ...input, credential, ownerId: 'bob' })).toThrow();
  expect(() =>
    restarted.open({ ...input, credential, endpoint: 'https://another.example/' }),
  ).toThrow();
  expect(() => destinationCredentials('different-secret').open({ ...input, credential })).toThrow();
});
