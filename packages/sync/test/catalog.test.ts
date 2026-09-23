import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createSyncController } from '../src/http/controller';
import { createSyncRuntime } from '../src/runtime';
import { alpha, beta, configure, fixture, runtime } from './support';

test('catalog exposes serializable metadata, and polling history survives restart with owner isolation', async () => {
  const f = runtime();
  try {
    const sync = await configure(f.engine);
    const resource = { ...alpha, id: sync.id };
    expect(f.engine.api.destinationTypes(alpha)).toEqual([
      {
        type: 'local',
        name: undefined,
        description: undefined,

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
    expect(() => f.engine.api.polls({ ...beta, id: sync.id })).toThrow('not found');
    await f.engine.close();
    const restarted = createSyncRuntime(f.options);
    try {
      expect(restarted.api.polls(resource)).toEqual(history);
      const app = createSyncController({ api: restarted.api, authorize: () => alpha });
      const invalid = await app.handle(
        new Request(`http://localhost/sync/syncs/${sync.id}/polls?offset=-1`),
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

test('source registration rejects duplicate names without persisting a manifest catalog', async () => {
  const f = runtime();
  try {
    expect(() => createSyncRuntime({ ...f.options, definitions: [fixture, fixture] })).toThrow(
      'definition conflict',
    );
    const db = new Database(f.files.path, { readonly: true });
    try {
      expect(
        db
          .query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('definitions','destinations')",
          )
          .all(),
      ).toEqual([]);
    } finally {
      db.close();
    }
    expect(Object.keys(f.engine.api).sort()).toEqual(
      [
        'connectSync',
        'createSync',
        'definitions',
        'deliveries',
        'destinationTypes',
        'polls',
        'queueRun',
        'retryDelivery',
        'setEnabled',
        'status',
        'sync',
        'syncs',
      ].sort(),
    );
    const definition = f.engine.api.definitions(alpha)[0]!;
    expect(definition).not.toHaveProperty('initialCheckpoint');
    expect(definition).not.toHaveProperty('checkpointSchema');
    expect(definition).not.toHaveProperty('kinds');
  } finally {
    await f.close();
  }
});
