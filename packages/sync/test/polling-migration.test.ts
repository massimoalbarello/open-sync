import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import releasedSchema from '../src/db/schema.sql' with { type: 'text' };
import type { Deliverable } from '../src/models/delivery';
import { defaultLimits } from '../src/models/limits';
import { SqliteAcquisition } from '../src/repositories/acquisition/sqlite';
import { SqliteCatalog } from '../src/repositories/catalog/sqlite';
import { SqliteDeliveries } from '../src/repositories/delivery/sqlite';
import { alpha, fixture, storage } from './support';

const migrationNames = ['0000-initial-schema', '0001-centralize-polling'];
const leaseMs = 60_000;
const futureRetry = 9_000_000_000_000;
const retryStates = ['retrying', 'interrupted', 'waiting_for_capacity'];
const delivery: Omit<Deliverable, 'openAsset'> = {
  id: 'saved-delivery',
  ownerId: alpha.ownerId,
  syncId: 'succeeded',
  definition: fixture.definition.id,
  records: [
    {
      operation: 'upsert',
      kind: 'item',
      id: 'saved',
      revision: 1,
      data: { value: 1 },
      assetRefs: { file: { id: 'saved-asset', version: '1' } },
    },
  ],
  assets: [
    {
      id: 'saved-asset',
      version: '1',
      name: 'saved.txt',
      mediaType: 'text/plain',
      size: Buffer.byteLength('saved'),
      sha256: new Bun.CryptoHasher('sha256').update('saved').digest('hex'),
    },
  ],
};
function legacyDatabase(path: string) {
  const db = new Database(path);
  db.exec(releasedSchema);
  db.exec('PRAGMA foreign_keys=ON');
  for (const state of ['succeeded', 'disabled', 'ready', 'running', ...retryStates]) {
    db.query(`INSERT INTO syncs (owner_id,id,definition_id,config,destination_type,
      destination_config,enabled,checkpoint,interval_ms,next_due_at,status,generation,expires_at,
      failure_count,resync) VALUES (?,?,?,'{"count":3}','local','{}',?, '2',60000,?,?,7,?,2,1)`).run(
      alpha.ownerId,
      state,
      fixture.definition.id,
      Number(state !== 'disabled'),
      futureRetry,
      state,
      state === 'running' ? futureRetry : null,
    );
  }
  db.query(
    `INSERT INTO record_state VALUES ('alpha','succeeded','item','saved','saved-hash',1,0)`,
  ).run();
  db.query(`INSERT INTO sync_polls(owner_id,sync_id,started_at,completed_at,records_processed,records_queued,state)
    VALUES ('alpha','succeeded',1,2,1,1,'succeeded')`).run();
  db.query(`INSERT INTO sync_polls(owner_id,sync_id,started_at,state,error_code)
    VALUES ('alpha','retrying',1,'retrying','execution_failed')`).run();
  const body = JSON.stringify(delivery);
  db.query(`INSERT INTO deliveries(owner_id,id,sync_id,body,bytes,record_count,due_at)
    VALUES (?,?,?,?,?,1,0)`).run(
    alpha.ownerId,
    delivery.id,
    delivery.syncId,
    body,
    Buffer.byteLength(body),
  );
  db.query(`INSERT INTO delivery_assets(id,owner_id,sync_id,generation,asset_id,asset_version,
    descriptor,ready,bytes,delivery_id) VALUES ('queued-file','alpha','succeeded',7,'saved-asset','1',?,1,5,?)`).run(
    JSON.stringify(delivery.assets[0]),
    delivery.id,
  );
  return db;
}
function queuedState(db: Database) {
  return {
    records: db.query('SELECT * FROM record_state').all(),
    polls: db.query('SELECT * FROM sync_polls ORDER BY id').all(),
    deliveries: db.query('SELECT * FROM deliveries ORDER BY sequence').all(),
    assets: db.query('SELECT * FROM delivery_assets').all(),
  };
}
function history(db: Database) {
  return db
    .query<{ name: string; applied_at: string }, []>('SELECT * FROM __migrations ORDER BY name')
    .all();
}

test('released databases adopt migration history without losing progress, leases, retries or queued data', () => {
  const files = storage();
  let db = legacyDatabase(files.path);
  const before = db.query('SELECT * FROM syncs ORDER BY id').all() as Record<string, unknown>[];
  const queue = queuedState(db);
  db.close();
  try {
    db = openDatabase(files.path);
    const after = db.query('SELECT * FROM syncs ORDER BY id').all();
    expect(after).toEqual(
      before.map(({ interval_ms: _interval, next_due_at, ...row }) => ({
        ...row,
        retry_at: retryStates.includes(String(row.status)) ? next_due_at : null,
      })),
    );
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(queuedState(db)).toEqual(queue);
    const applied = history(db);
    expect(applied.map(({ name }) => name)).toEqual(migrationNames);
    // Reopening must leave both the data and recorded application times unchanged.
    db.close();
    db = openDatabase(files.path);
    expect(history(db)).toEqual(applied);
    expect(db.query('SELECT * FROM syncs ORDER BY id').all()).toEqual(after);
    expect(queuedState(db)).toEqual(queue);
    const catalog = new SqliteCatalog(db);
    const acquisition = new SqliteAcquisition({ db, limits: defaultLimits });
    expect(acquisition.claim(leaseMs)?.sync.id).toBe('ready');
    expect(acquisition.claim(leaseMs)).toBeUndefined();
    acquisition.poll();
    expect(acquisition.claim(leaseMs)?.sync.id).toBe('succeeded');
    expect(acquisition.claim(leaseMs)).toBeUndefined();
    expect(new SqliteDeliveries(db).claim(leaseMs)?.delivery).toEqual(delivery);
    expect(
      catalog.createSync({
        ...alpha,
        definition: 'test',
        config: { count: 1 },
        destination: { type: 'local', config: {} },
        initialCheckpoint: 0,
      }).retryAt,
    ).toBeNull();
  } finally {
    db.close();
    files.close();
  }
});

test('fresh databases apply the same ordered migration history', () => {
  using db = openDatabase(':memory:');
  expect(history(db).map(({ name }) => name)).toEqual(migrationNames);
  const columns = db
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('syncs')")
    .all()
    .map(({ name }) => name);
  expect(columns).toContain('retry_at');
  expect(columns).not.toContain('interval_ms');
  expect(columns).not.toContain('next_due_at');
});

test.each([false, true])(
  'failed migration rolls back schema, data and history (baseline recorded: %s)',
  (recorded) => {
    const files = storage();
    let db = legacyDatabase(files.path);
    if (recorded) {
      db.query('CREATE TABLE __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)').run();
      db.query('INSERT INTO __migrations VALUES (?,?)').run(
        migrationNames[0]!,
        '2026-10-01T00:00:00.000Z',
      );
    }
    db.exec(
      "CREATE TRIGGER fail_migration BEFORE UPDATE ON syncs BEGIN SELECT RAISE(ABORT,'injected'); END",
    );
    const before = db.query('SELECT * FROM syncs ORDER BY id').all();
    const schemaBefore = db.query('SELECT * FROM sqlite_schema ORDER BY name').all();
    const queue = queuedState(db);
    const historyBefore = recorded ? history(db) : [];
    db.close();
    try {
      expect(() => openDatabase(files.path)).toThrow('injected');
      db = new Database(files.path);
      expect(db.query('SELECT * FROM syncs ORDER BY id').all()).toEqual(before);
      expect(db.query('SELECT * FROM sqlite_schema ORDER BY name').all()).toEqual(schemaBefore);
      expect(queuedState(db)).toEqual(queue);
      if (recorded) {
        expect(history(db)).toEqual(historyBefore);
      }
      db.exec('DROP TRIGGER fail_migration');
      db.close();
      db = openDatabase(files.path);
      expect(history(db).map(({ name }) => name)).toEqual(migrationNames);
      expect(db.query('SELECT id FROM syncs').all()).toHaveLength(before.length);
      expect(queuedState(db)).toEqual(queue);
    } finally {
      db.close();
      files.close();
    }
  },
);

test.each(['future', 'missing-baseline'])(
  'unsupported migration history fails closed (%s)',
  (state) => {
    const files = storage();
    let db = openDatabase(files.path);
    if (state === 'future') {
      db.query('INSERT INTO __migrations VALUES (?,?)').run(
        '9999_future',
        new Date().toISOString(),
      );
    } else {
      db.query('DELETE FROM __migrations WHERE name=?').run(migrationNames[0]!);
    }
    const before = history(db);
    const schemaBefore = db.query('SELECT * FROM sqlite_schema ORDER BY name').all();
    db.close();
    try {
      expect(() => openDatabase(files.path)).toThrow('Unsupported sync database migration history');
      db = new Database(files.path);
      expect(history(db)).toEqual(before);
      expect(db.query('SELECT * FROM sqlite_schema ORDER BY name').all()).toEqual(schemaBefore);
    } finally {
      db.close();
      files.close();
    }
  },
);

test('an incompatible unversioned database fails without recording a partial baseline', () => {
  const files = storage();
  let db = new Database(files.path);
  // A failure in the middle of the baseline must not be hidden by later successful DDL.
  db.query('CREATE TABLE deliveries (unexpected TEXT)').run();
  const before = db.query('SELECT * FROM sqlite_schema ORDER BY name').all();
  db.close();
  try {
    expect(() => openDatabase(files.path)).toThrow();
    db = new Database(files.path);
    expect(db.query('SELECT * FROM sqlite_schema ORDER BY name').all()).toEqual(before);
  } finally {
    db.close();
    files.close();
  }
});
