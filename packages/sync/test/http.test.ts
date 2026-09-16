import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createSyncController } from '../src/http/controller';
import { alpha, beta, configure, runtime } from './support';

const notFound = 404;
const unauthorized = 401;
const validation = 422;

test('mountable management routes require host authorization and preserve resource ownership', async () => {
  const f = runtime();
  try {
    const installation = await configure(f.engine);
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
    expect((await app.handle(new Request('http://localhost/api/sync/installations'))).status).toBe(
      unauthorized,
    );
    const missing = await app.handle(
      new Request(`http://localhost/api/sync/installations/${installation.id}`, {
        headers: { 'test-actor': 'beta' },
      }),
    );
    expect(missing.status).toBe(notFound);
    const invalid = await app.handle(
      new Request('http://localhost/api/sync/installations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'test-actor': 'alpha' },
        body: '{}',
      }),
    );
    expect(invalid.status).toBe(validation);
    const list = await app.handle(
      new Request('http://localhost/api/sync/installations', {
        headers: { 'test-actor': 'alpha' },
      }),
    );
    expect(((await list.json()) as { installations: unknown[] }).installations).toHaveLength(1);
  } finally {
    await f.close();
  }
});
