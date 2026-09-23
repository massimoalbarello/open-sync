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

test('deliverable inspection is paginated, scoped to its sync, and preserves original bundles', async () => {
  const f = runtime({
    destination: {
      configSchema: { type: 'object' },
      deliver: () => Promise.resolve({ status: 'rejected', code: 'held' }),
    },
  });
  const count = 21;
  const pageSize = 20;
  try {
    const sync = await f.engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      destination: { type: 'local', input: {} },
      config: { count },
    });
    for (let step = 0; step < count; step++) {
      await f.engine.tick();
    }
    const otherSync = await f.engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      destination: { type: 'local', input: {} },
      config: { count: 1 },
      enabled: false,
    });
    const app = createSyncController({
      api: f.engine.api,
      authorize: (request) => (request.headers.get('test-owner') === 'beta' ? beta : alpha),
    });
    const url = `http://localhost/sync/syncs/${sync.id}/deliverables`;
    const first = await app.handle(new Request(url));
    const firstPage = (await first.json()) as ReturnType<typeof f.engine.api.deliveries>;
    expect(firstPage.deliveries).toHaveLength(pageSize);
    const second = await app.handle(new Request(`${url}?before=${firstPage.nextCursor}`));
    const secondPage = (await second.json()) as typeof firstPage;
    expect(secondPage.deliveries).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      new Set([...firstPage.deliveries, ...secondPage.deliveries].map(({ id }) => id)).size,
    ).toBe(count);
    const blocked = secondPage.deliveries[0]!;
    const detail = await app.handle(new Request(`${url}/${blocked.id}`));
    expect(await detail.json()).toMatchObject({
      id: blocked.id,
      syncId: sync.id,
      records: [{ id: '0', data: { value: 0 }, revision: 1 }],
      assets: [],
    });
    expect((await app.handle(new Request(url, { headers: { 'test-owner': 'beta' } }))).status).toBe(
      notFound,
    );
    for (const suffix of ['', '/retry']) {
      const denied = await app.handle(
        new Request(
          `http://localhost/sync/syncs/${otherSync.id}/deliverables/${blocked.id}${suffix}`,
          { method: suffix ? 'POST' : 'GET' },
        ),
      );
      expect(denied.status).toBe(notFound);
    }
    expect((await app.handle(new Request(`${url}?before=0`))).status).toBe(validation);
    expect(() => f.engine.api.deliveries({ ...alpha, syncId: sync.id, before: 0 })).toThrow();
    expect(
      (await app.handle(new Request(`${url}/${blocked.id}/retry`, { method: 'POST' }))).ok,
    ).toBe(true);
    expect(f.engine.api.status(alpha).queue.pendingDeliveries).toBe(count);
  } finally {
    await f.close();
  }
});
