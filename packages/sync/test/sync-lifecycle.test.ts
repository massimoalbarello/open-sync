import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import providerSchema from '../src/db/providers.sql' with { type: 'text' };
import { createSyncController } from '../src/http/controller';
import type { SyncContext, SyncRegistration } from '../src/models/definition';
import type { Deliverable } from '../src/models/delivery';
import { defaultLimits } from '../src/models/limits';
import { DirectoryAssets } from '../src/repositories/assets/filesystem';
import { SqliteAssets } from '../src/repositories/assets/sqlite';
import { createSyncRuntime } from '../src/runtime';
import {
  accepted,
  alpha,
  beta,
  configure,
  fixture,
  page,
  repositories,
  savedSync,
  storage,
} from './support';

const leaseMs = 60_000;
const asset = { id: 'file', version: '1', name: 'file.txt', mediaType: 'text/plain' };

async function attachment(context: SyncContext) {
  const ref = await context.assets.capture({
    ...asset,
    read: () => Promise.resolve(new Blob(['content']).stream()),
  });
  return { ...page.records[0]!, assetRefs: { file: ref } };
}

test('resync replays all pages and assets across capacity, retry, pause and restart, then deduplicates normally', async () => {
  const files = storage();
  const received: { id: string; record: Deliverable['records'][number]; bytes: string }[] = [];
  const events: string[] = [];
  let reject = false;
  let transientFailure = false;
  const definition: SyncRegistration = {
    ...fixture,
    load: () => ({
      async step(context) {
        const cursor = Number(context.checkpoint);
        if (cursor === 1 && transientFailure) {
          transientFailure = false;
          throw new Error('retry');
        }
        const record = await attachment(context);
        return {
          records: [{ ...record, id: String(cursor) }],
          checkpoint: (cursor + 1) % 2,
          complete: cursor === 1,
        };
      },
    }),
  };
  const options = {
    databasePath: files.path,
    definitions: [definition],
    limits: { maxPendingRecords: 1 },
    onEvent: (event: { code: string }) => events.push(event.code),
    destinationTypes: {
      local: {
        ...accepted,
        async deliver({ deliverable }: Parameters<typeof accepted.deliver>[0]) {
          if (reject) {
            return { status: 'rejected' as const, code: 'held' };
          }
          received.push({
            id: deliverable.id,
            record: deliverable.records[0]!,
            bytes: await new Response(await deliverable.openAsset(deliverable.assets[0]!)).text(),
          });
          return { status: 'accepted' as const };
        },
      },
    },
  };
  let engine = createSyncRuntime(options);
  try {
    const sync = await configure(engine);
    const scope = { ...alpha, id: sync.id };
    const initialTicks = 4;
    for (let i = 0; i < initialTicks; i++) {
      await engine.tick();
    }
    expect(received.map(({ record }) => record.revision)).toEqual([1, 1]);
    reject = true;
    await engine.api.resync(scope);
    await engine.tick();
    await engine.tick();
    expect(engine.api.sync(scope).status).toBe('waiting_for_capacity');
    const queued = engine.api.deliveries(alpha).deliveries[0]!;
    expect(queued.state).toBe('blocked');
    const replayId = engine.api.runs(scope).runs[0]!.id;
    await engine.api.setEnabled({ ...scope, enabled: false });
    await engine.close();
    engine = createSyncRuntime(options);
    await engine.tick();
    expect(engine.api.runs(scope).runs[0]).toMatchObject({
      id: replayId,
      mode: 'resync',
      state: 'paused',
      recordsQueued: 1,
    });
    reject = false;
    engine.api.retryDelivery({ ...alpha, id: queued.id });
    await engine.tick();
    transientFailure = true;
    await engine.api.setEnabled({ ...scope, enabled: true });
    await engine.tick();
    expect(engine.api.sync(scope)).toMatchObject({
      status: 'retrying',
      errorCode: 'execution_failed',
    });
    await engine.close();
    engine = createSyncRuntime(options);
    engine.api.runNow(scope);
    await engine.tick();
    await engine.tick();
    expect(engine.api.runs(scope).runs[0]).toMatchObject({
      id: replayId,
      mode: 'resync',
      state: 'succeeded',
      recordsProcessed: 2,
      recordsQueued: 2,
    });
    expect(received.map(({ record }) => [record.id, record.revision])).toEqual([
      ['0', 1],
      ['1', 1],
      ['0', 2],
      ['1', 2],
    ]);
    expect(new Set(received.map(({ id }) => id)).size).toBe(initialTicks);
    expect(received.every(({ bytes }) => bytes === 'content')).toBe(true);
    engine.api.runNow(scope);
    await engine.tick();
    await engine.tick();
    expect(engine.api.runs(scope).runs[0]).toMatchObject({
      mode: 'incremental',
      recordsProcessed: 2,
      recordsQueued: 0,
    });
    expect(received).toHaveLength(initialTicks);
    expect(await readdir(`${files.path}.assets`)).toEqual([]);
    expect(events).toContain('execution_failed');
  } finally {
    await engine.close();
    files.close();
  }
});

test('resync fences old captures, keeps pending FIFO and replays explicit tombstones without resetting revisions', () => {
  const f = repositories();
  const scope = { ...alpha, id: f.sync.id };
  const assets = new SqliteAssets({
    db: f.db,
    maxBytes: defaultLimits.maxPendingAssetBytes,
    maxSyncBytes: defaultLimits.maxSyncAssetBytes,
  });
  try {
    f.acquisition.commit({
      lease: f.acquisition.claim(leaseMs)!,
      page,
      definition: fixture.definition,
    });
    const pending = f.deliveries.claim(leaseMs)!;
    f.deliveries.complete({
      lease: pending,
      result: { status: 'rejected', code: 'hold' },
      delay: 0,
    });
    const stale = f.acquisition.claim(leaseMs)!;
    f.catalog.resync({ ...scope, checkpoint: 0 });
    expect(() =>
      f.acquisition.commit({ lease: stale, page, definition: fixture.definition }),
    ).toThrow('lease lost');
    expect(() => assets.stage({ lease: stale, asset })).toThrow('lease lost');
    const tombstones = {
      ...page,
      complete: true,
      records: [
        { operation: 'delete' as const, kind: 'item', id: 'first' },
        { operation: 'delete' as const, kind: 'item', id: 'unseen' },
      ],
    };
    for (let i = 0; i < 2; i++) {
      if (i) {
        f.catalog.resync({ ...scope, checkpoint: 0 });
      }
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        page: tombstones,
        definition: fixture.definition,
      });
    }
    expect(f.deliveries.claim(leaseMs)).toBeUndefined();
    f.deliveries.retry({ ...alpha, id: pending.delivery.id });
    const ordered: Deliverable['records'][] = [];
    while (true) {
      const delivery = f.deliveries.claim(leaseMs);
      if (!delivery) {
        break;
      }
      ordered.push(delivery.delivery.records);
      f.deliveries.complete({ lease: delivery, result: { status: 'accepted' }, delay: 0 });
    }
    const finalRevision = 3;
    expect(ordered.map((records) => records.map(({ id, revision }) => [id, revision]))).toEqual([
      [['first', 1]],
      [
        ['first', 2],
        ['unseen', 1],
      ],
      [
        ['first', finalRevision],
        ['unseen', 2],
      ],
    ]);
    f.catalog.runNow(scope);
    f.acquisition.commit({
      lease: f.acquisition.claim(leaseMs)!,
      page: tombstones,
      definition: fixture.definition,
    });
    expect(f.deliveries.status(alpha).pendingRecords).toBe(0);
  } finally {
    f.close();
  }
});

test('idempotent enable preserves active work; resync cancels only the old acquisition and late results cannot commit', async () => {
  const files = storage();
  const entered = Promise.withResolvers<void>();
  const late = Promise.withResolvers<typeof page>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => ({
          step(context) {
            calls++;
            if (calls === 1) {
              signal = context.signal;
              entered.resolve();
              return late.promise;
            }
            return Promise.resolve({ ...page, complete: true });
          },
        }),
      },
    ],
    destinationTypes: { local: accepted },
  });
  try {
    const sync = await configure(engine);
    const scope = { ...alpha, id: sync.id };
    const first = engine.tick();
    await entered.promise;
    const run = engine.api.runs(scope).runs[0]!;
    await engine.api.setEnabled({ ...scope, enabled: true });
    expect(signal!.aborted).toBe(false);
    expect(engine.api.runs(scope).runs[0]).toEqual(run);
    await engine.api.resync(scope);
    expect(signal!.aborted).toBe(true);
    await first;
    await engine.tick();
    late.resolve({ ...page, checkpoint: 99 });
    await Bun.sleep(0);
    expect(savedSync({ path: files.path, scope }).checkpoint).toBe(1);
    expect(engine.api.runs(scope).runs).toMatchObject([
      { mode: 'resync', state: 'succeeded', recordsQueued: 1 },
      { id: run.id, state: 'cancelled' },
    ]);
  } finally {
    late.resolve(page);
    await engine.close();
    files.close();
  }
});

test('removal is owner-scoped and fences both durable leases without deleting provider mappings', () => {
  const f = repositories();
  const scope = { ...alpha, id: f.sync.id };
  try {
    f.db.exec(providerSchema);
    f.db
      .query(
        'INSERT INTO provider_connections(owner_id,id,connector_id,account,service) VALUES (?,?,?,?,?)',
      )
      .run(alpha.ownerId, 'account', 'connection', 'alice', 'github');
    f.db
      .query('INSERT INTO provider_authorizations(owner_id,id,request_id,service) VALUES (?,?,?,?)')
      .run(alpha.ownerId, 'auth', 'request', 'github');
    f.acquisition.commit({
      lease: f.acquisition.claim(leaseMs)!,
      page,
      definition: fixture.definition,
    });
    const source = f.acquisition.claim(leaseMs)!;
    const delivery = f.deliveries.claim(leaseMs)!;
    expect(() => f.catalog.removeSync({ ...beta, id: f.sync.id })).toThrow('not found');
    expect(f.deliveries.status(alpha).pendingRecords).toBe(1);
    f.catalog.removeSync(scope);
    expect(() =>
      f.acquisition.commit({ lease: source, page, definition: fixture.definition }),
    ).toThrow('lease lost');
    expect(() =>
      f.deliveries.complete({ lease: delivery, result: { status: 'accepted' }, delay: 0 }),
    ).toThrow('lease lost');
    for (const table of ['syncs', 'sync_runs', 'record_state', 'deliveries']) {
      expect(f.db.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
    expect(f.db.query('SELECT id FROM provider_connections').all()).toEqual([{ id: 'account' }]);
    expect(f.db.query('SELECT id FROM provider_authorizations').all()).toEqual([{ id: 'auth' }]);
  } finally {
    f.close();
  }
});

test('removal aborts acquisition and delivery, retains failed cleanup through restart, and cannot be undone by late completions', async () => {
  const files = storage();
  const sourceEntered = Promise.withResolvers<void>();
  const destinationEntered = Promise.withResolvers<void>();
  const lateSource = Promise.withResolvers<typeof page>();
  const lateDestination = Promise.withResolvers<{ status: 'accepted' }>();
  let sourceSignal: AbortSignal | undefined;
  let deliverySignal: AbortSignal | undefined;
  const options = {
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => ({
          async step(context: SyncContext) {
            if (context.checkpoint === 1) {
              sourceSignal = context.signal;
              sourceEntered.resolve();
              return lateSource.promise;
            }
            return { ...page, records: [await attachment(context)] };
          },
        }),
      },
    ],
    destinationTypes: {
      local: {
        ...accepted,
        deliver({ signal }: Parameters<typeof accepted.deliver>[0]) {
          deliverySignal = signal;
          destinationEntered.resolve();
          return lateDestination.promise;
        },
      },
    },
  };
  let engine = createSyncRuntime(options);
  const db = new Database(files.path);
  let deletion: ReturnType<typeof spyOn> | undefined;
  try {
    const sync = await configure(engine);
    await engine.tick();
    const active = engine.tick();
    await Promise.all([sourceEntered.promise, destinationEntered.promise]);
    deletion = spyOn(DirectoryAssets.prototype, 'remove').mockRejectedValue(
      new Error('temporary unlink failure'),
    );
    const app = createSyncController({ api: engine.api, authorize: () => alpha });
    const response = await app.handle(
      new Request(`http://localhost/sync/syncs/${sync.id}`, { method: 'DELETE' }),
    );
    const ok = 200;
    expect(response.status).toBe(ok);
    await active.catch(() => undefined);
    expect(sourceSignal!.aborted).toBe(true);
    expect(deliverySignal!.aborted).toBe(true);
    expect(db.query('SELECT bytes FROM delivery_assets').all()).toEqual([{ bytes: 7 }]);
    expect(await readdir(`${files.path}.assets`)).toHaveLength(1);
    lateSource.resolve({ ...page, checkpoint: 99 });
    lateDestination.resolve({ status: 'accepted' });
    await Bun.sleep(0);
    expect(engine.api.syncs(alpha)).toEqual([]);
    expect(engine.api.deliveries(alpha).deliveries).toEqual([]);
    await engine.close().catch(() => undefined);
    deletion.mockRestore();
    deletion = undefined;
    engine = createSyncRuntime(options);
    await engine.tick();
    expect(db.query('SELECT * FROM delivery_assets').all()).toEqual([]);
    expect(await readdir(`${files.path}.assets`)).toEqual([]);
  } finally {
    deletion?.mockRestore();
    lateSource.resolve(page);
    lateDestination.resolve({ status: 'accepted' });
    await engine.close().catch(() => undefined);
    db.close();
    files.close();
  }
});
