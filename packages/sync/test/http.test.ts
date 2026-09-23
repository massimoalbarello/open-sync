import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createSyncController } from '../src/http/controller';
import { alpha, beta, configure, fixture, runtime } from './support';

const notFound = 404;
const unauthorized = 401;
const validation = 422;

test('mountable management routes require host authorization and preserve resource ownership', async () => {
  const f = runtime();
  try {
    const sync = await configure(f.engine);
    const app = new Elysia().group('/api', (app) =>
      app.use(
        createSyncController({
          api: f.engine.api,
          authorize: (req) =>
            req.headers.get('test-actor') === 'alpha'
              ? alpha
              : req.headers.get('test-actor') === 'beta'
                ? beta
                : null,
        }),
      ),
    );
    expect((await app.handle(new Request('http://localhost/api/sync/syncs'))).status).toBe(
      unauthorized,
    );
    const missing = await app.handle(
      new Request(`http://localhost/api/sync/syncs/${sync.id}`, {
        headers: { 'test-actor': 'beta' },
      }),
    );
    expect(missing.status).toBe(notFound);
    const pollsUrl = `http://localhost/api/sync/syncs/${sync.id}/polls`;
    expect((await app.handle(new Request(pollsUrl))).status).toBe(unauthorized);
    expect(
      (
        await app.handle(
          new Request(pollsUrl, {
            headers: { 'test-actor': 'beta' },
          }),
        )
      ).status,
    ).toBe(notFound);
    await f.engine.tick();
    const polls = await app.handle(
      new Request(pollsUrl, {
        headers: { 'test-actor': 'alpha' },
      }),
    );
    expect(await polls.json()).toEqual(f.engine.api.polls({ ...alpha, id: sync.id }));
    const invalid = await app.handle(
      new Request('http://localhost/api/sync/syncs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'test-actor': 'alpha' },
        body: '{}',
      }),
    );
    expect(invalid.status).toBe(validation);
    const list = await app.handle(
      new Request('http://localhost/api/sync/syncs', {
        headers: { 'test-actor': 'alpha' },
      }),
    );
    expect(((await list.json()) as { syncs: unknown[] }).syncs).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('queue inspection pages a real backlog without exposing another owner or changing work', async () => {
  const f = runtime({
    destination: {
      configSchema: { type: 'object' },
      deliver: () => Promise.resolve({ status: 'retry', retryAfterMs: 0 }),
    },
  });
  const count = 51;
  try {
    const destination = { type: 'local', input: {} };
    await f.engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      destination,
      config: { count },
    });
    for (let step = 0; step < count; step++) {
      await f.engine.tick();
    }
    const app = createSyncController({
      api: f.engine.api,
      authorize: (request) => (request.headers.get('test-owner') === 'beta' ? beta : alpha),
    });
    const first = await app.handle(new Request('http://localhost/sync/deliveries'));
    const firstPage = (await first.json()) as ReturnType<typeof f.engine.api.deliveries>;
    expect(firstPage.deliveries).toHaveLength(firstPage.pageSize);
    expect(firstPage.hasMore).toBe(true);
    const second = await app.handle(
      new Request(`http://localhost/sync/deliveries?offset=${firstPage.pageSize}`),
    );
    const secondPage = (await second.json()) as typeof firstPage;
    expect(secondPage.deliveries).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);
    expect(
      new Set([...firstPage.deliveries, ...secondPage.deliveries].map((item) => item.id)).size,
    ).toBe(count);
    const other = await app.handle(
      new Request('http://localhost/sync/deliveries', { headers: { 'test-owner': 'beta' } }),
    );
    expect(await other.json()).toEqual({
      deliveries: [],
      hasMore: false,
      pageSize: firstPage.pageSize,
    });
    const invalid = await app.handle(new Request('http://localhost/sync/deliveries?offset=-1'));
    expect(invalid.status).toBe(validation);
    expect(() => f.engine.api.deliveries({ ...alpha, offset: -1 })).toThrow();
    expect(f.engine.api.status(alpha).queue.pendingDeliveries).toBe(count);
  } finally {
    await f.close();
  }
});
