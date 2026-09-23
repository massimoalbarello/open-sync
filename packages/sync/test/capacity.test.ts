import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import type { SyncRegistration } from '../src/models/definition';
import { SqliteAssets } from '../src/repositories/assets/sqlite';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, fixture, page, repositories, savedSync, storage } from './support';

const leaseMs = 60_000;

test('a full sync pauses without consuming the budget of a healthy sync at the same destination', async () => {
  const files = storage();
  let blockedSource = '';
  const received: string[] = [];
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [fixture],
    limits: { maxSyncPendingRecords: 2, maxPendingRecords: 5 },
    destinationTypes: {
      local: {
        ...accepted,
        deliver: ({ deliverable: delivery }) => {
          if (delivery.syncId === blockedSource) {
            return Promise.resolve({ status: 'rejected', code: 'blocked' });
          }
          received.push(delivery.syncId);
          return Promise.resolve({ status: 'accepted' });
        },
      },
    },
  });
  try {
    const destination = { type: 'local', input: {} };
    const blocked = await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 5 },
      destination,
    });
    blockedSource = blocked.id;
    const healthy = await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 5 },
      destination,
    });
    const rounds = 8;
    for (let i = 0; i < rounds; i++) {
      await engine.tick();
    }
    expect(savedSync({ path: files.path, scope: { ...alpha, id: blocked.id } })).toMatchObject({
      checkpoint: 2,
      status: 'waiting_for_capacity',
    });
    expect(engine.api.sync({ ...alpha, id: healthy.id }).status).toBe('succeeded');
    const expectedRecords = 5;
    expect(received).toHaveLength(expectedRecords);
    expect(engine.api.status(alpha).queue.pendingRecords).toBe(2);
  } finally {
    await engine.close();
    files.close();
  }
});

test('concurrent steps cannot overcommit the global record budget or advance rejected progress', () => {
  const f = repositories({ maxPendingRecords: 1 });
  try {
    const first = f.acquisition.claim(leaseMs)!;
    const other = f.catalog.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      initialCheckpoint: 0,
      destination: f.sync.destination,
    });
    const second = f.acquisition.claim(leaseMs)!;
    f.acquisition.commit({ lease: first, page, definition: fixture.definition });
    expect(() =>
      f.acquisition.commit({ lease: second, page, definition: fixture.definition }),
    ).toThrow('waiting for capacity');
    expect(f.catalog.sync({ ...alpha, id: other.id }).checkpoint).toBe(0);
    const delivery = f.deliveries.claim(leaseMs)!;
    f.deliveries.complete({ lease: delivery, result: { status: 'accepted' }, delay: 0 });
    f.acquisition.commit({ lease: second, page, definition: fixture.definition });
    expect(f.catalog.sync({ ...alpha, id: other.id }).checkpoint).toBe(1);
  } finally {
    f.close();
  }
});

test('download reservations account for other in-flight downloads and survive restart', () => {
  const f = repositories();
  const limits = {
    maxBytes: 8,
    maxSyncBytes: 6,
  };
  try {
    const first = f.acquisition.claim(leaseMs)!;
    f.catalog.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      initialCheckpoint: 0,
      destination: f.sync.destination,
    });
    const second = f.acquisition.claim(leaseMs)!;
    const assets = new SqliteAssets({ db: f.db, ...limits });
    const left = assets.stage({
      lease: first,
      asset: { id: 'file', version: '1', name: 'file', mediaType: 'text/plain' },
    });
    const right = assets.stage({
      lease: second,
      asset: { id: 'file', version: '1', name: 'file', mediaType: 'text/plain' },
    });
    assets.reserve({ lease: first, id: left, bytes: 4 });
    assets.reserve({ lease: second, id: right, bytes: 4 });
    expect(() => assets.reserve({ lease: first, id: left, bytes: 5 })).toThrow(
      'waiting for capacity',
    );
    const reopened = openDatabase(f.files.path);
    try {
      const restored = new SqliteAssets({ db: reopened, ...limits });
      expect(() => restored.reserve({ lease: second, id: right, bytes: 5 })).toThrow(
        'waiting for capacity',
      );
      // Only deletion of the actual file releases its charge, not completion of the source run.
      f.acquisition.finish({ lease: first, state: 'interrupted', delay: leaseMs });
      expect(() => restored.reserve({ lease: second, id: right, bytes: 5 })).toThrow(
        'waiting for capacity',
      );
      restored.discarded(left);
      restored.reserve({ lease: second, id: right, bytes: 6 });
      expect(() => restored.reserve({ lease: second, id: right, bytes: 7 })).toThrow(
        'step exceeds asset capacity',
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

function assetSource(): SyncRegistration {
  return {
    ...fixture,
    load: () => ({
      async step({ assets }) {
        const asset = await assets.capture({
          id: 'file',
          version: '1',
          name: 'file',
          mediaType: 'text/plain',
          read: () => Promise.resolve(new Blob(['data']).stream()),
        });
        return {
          ...page,
          complete: true,
          records: page.records.map((record) => ({ ...record, assetRefs: { file: asset } })),
        };
      },
    }),
  };
}

test('a step larger than its budget preserves pending assets and resumes after configuration changes', async () => {
  const files = storage();
  const options = {
    databasePath: files.path,
    definitions: [assetSource()],
    destinationTypes: {
      local: {
        ...accepted,

        deliver: () => Promise.resolve({ status: 'rejected' as const, code: 'hold' }),
      },
    },
  };
  let engine = createSyncRuntime({ ...options, limits: { maxSyncAssetBytes: 2 } });
  try {
    const destination = { type: 'local', input: {} };
    const sync = await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination,
    });
    const resource = { ...alpha, id: sync.id };
    const waits = 4;
    for (let i = 0; i < waits; i++) {
      engine.api.queueRun(resource);
      await engine.tick();
      expect(savedSync({ path: files.path, scope: resource })).toMatchObject({
        checkpoint: 0,
        status: 'step_exceeds_asset_capacity',
      });
    }
    await engine.close();
    const db = new Database(files.path);
    expect(db.query('SELECT COUNT(*) AS count FROM delivery_assets').get()).toEqual({ count: 0 });
    db.close();
    engine = createSyncRuntime(options);
    engine.api.queueRun(resource);
    await engine.tick();
    expect(savedSync({ path: files.path, scope: resource })).toMatchObject({
      checkpoint: 1,
      status: 'succeeded',
    });
    expect(engine.api.status(alpha).queue.pendingRecords).toBe(1);
    await engine.close();
    const reopened = openDatabase(files.path);
    try {
      expect(reopened.query('SELECT bytes FROM delivery_assets').all()).toEqual([{ bytes: 4 }]);
    } finally {
      reopened.close();
    }
  } finally {
    await engine.close();
    files.close();
  }
});
