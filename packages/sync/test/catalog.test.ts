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
    await f.engine.tick();
    const history = f.engine.api.runs(resource);
    expect(history.runs).toMatchObject([{ state: 'succeeded', pages: 3, checkpointRevision: 3 }]);
    expect(history.hasMore).toBe(false);
    expect(history.runs[0]!.completedAt).not.toBeNull();
    expect(() => f.engine.api.runs({ ...beta, id: installation.id })).toThrow('not found');
    await f.engine.close();
    const restarted = createSyncRuntime(f.options);
    try {
      expect(restarted.api.runs(resource)).toEqual(history);
      const app = createSyncController({ api: restarted.api, authorize: () => alpha });
      const invalid = await app.handle(
        new Request(`http://localhost/sync/installations/${installation.id}/runs?offset=-1`),
      );
      const validationStatus = 422;
      expect(invalid.status).toBe(validationStatus);
      restarted.api.queueRun(resource);
      await restarted.tick();
      expect(restarted.api.runs(resource).runs).toHaveLength(2);
      expect(restarted.api.runs({ ...resource, offset: 1 }).runs).toHaveLength(1);
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
  }
});
