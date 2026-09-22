import { expect, test } from 'bun:test';
import { createSyncController } from '../src/http/controller';
import { createSyncRuntime } from '../src/runtime';
import { alpha, beta, configure, runtime } from './support';

test('catalog exposes serializable metadata, and polling history survives restart with owner isolation', async () => {
  const f = runtime();
  try {
    const installation = await configure(f.engine);
    const resource = { ...alpha, id: installation.id };
    expect(f.engine.api.destinationTypes(alpha)).toEqual([
      {
        type: 'local',
        name: undefined,
        description: undefined,
        version: '1',
        configSchema: { type: 'object', additionalProperties: false },
        setupSchema: { type: 'object', additionalProperties: false },
      },
    ]);
    const stepCount = 3;
    for (let step = 0; step < stepCount; step++) {
      await f.engine.tick();
    }
    const history = f.engine.api.polls(resource);
    expect(history.polls).toMatchObject([
      { state: 'succeeded', recordsProcessed: 3, recordsChanged: 3, attemptCount: 3 },
    ]);
    expect(history.hasMore).toBe(false);
    expect(history.polls[0]!.completedAt).not.toBeNull();
    expect(() => f.engine.api.polls({ ...beta, id: installation.id })).toThrow('not found');
    await f.engine.close();
    const restarted = createSyncRuntime(f.options);
    try {
      expect(restarted.api.polls(resource)).toEqual(history);
      const app = createSyncController({ api: restarted.api, authorize: () => alpha });
      const invalid = await app.handle(
        new Request(`http://localhost/sync/installations/${installation.id}/polls?offset=-1`),
      );
      const validationStatus = 422;
      expect(invalid.status).toBe(validationStatus);
      restarted.api.queueRun(resource);
      await restarted.tick();
      expect(restarted.api.polls(resource).polls).toHaveLength(2);
      expect(restarted.api.polls({ ...resource, offset: 1 }).polls).toHaveLength(1);
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
  }
});
