import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import { defaultLimits } from '../src/models/limits';
import { SqliteAcquisition } from '../src/repositories/acquisition/sqlite';
import { SqliteCatalog } from '../src/repositories/catalog/sqlite';
import { alpha, fixture, storage } from './support';

const legacySchema = `CREATE TABLE syncs (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, definition_id TEXT NOT NULL,
  connection TEXT, config TEXT NOT NULL, destination_type TEXT NOT NULL, destination_config TEXT NOT NULL,
  enabled INTEGER NOT NULL, checkpoint TEXT NOT NULL,
  interval_ms INTEGER NOT NULL, next_due_at INTEGER NOT NULL, status TEXT NOT NULL,
  error_code TEXT, generation INTEGER NOT NULL DEFAULT 0, expires_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0, resync INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id,id)
);`;
const leaseMs = 60_000;
const futureRetry = 9_000_000_000_000;
function legacyDatabase(path: string) {
  const db = new Database(path);
  db.exec(legacySchema);
  for (const state of ['succeeded', 'retrying', 'disabled', 'ready', 'running']) {
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
  return db;
}

test('legacy polling schedules migrate without losing progress, leases, backoff or queued data', () => {
  const files = storage();
  let db = legacyDatabase(files.path);
  // Real foreign keys and populated dependent tables must survive the column removal.
  db.exec(`CREATE TABLE retained (
    sync_id TEXT, owner_id TEXT, payload TEXT,
    FOREIGN KEY(owner_id,sync_id) REFERENCES syncs(owner_id,id)
  ); INSERT INTO retained VALUES ('succeeded','alpha','queued records and assets');`);
  const before = db.query('SELECT * FROM syncs ORDER BY id').all() as Record<string, unknown>[];
  db.close();
  try {
    db = openDatabase(files.path);
    const after = db.query('SELECT * FROM syncs ORDER BY id').all();
    expect(after).toEqual(
      before.map(({ interval_ms: _interval, next_due_at, ...row }) => ({
        ...row,
        retry_at: row.status === 'retrying' ? next_due_at : null,
      })),
    );
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.query('SELECT * FROM retained').all()).toEqual([
      { sync_id: 'succeeded', owner_id: 'alpha', payload: 'queued records and assets' },
    ]);
    db.close();
    db = openDatabase(files.path);
    expect(db.query('SELECT * FROM syncs ORDER BY id').all()).toEqual(after);
    const catalog = new SqliteCatalog(db);
    const acquisition = new SqliteAcquisition({ db, limits: defaultLimits });
    expect(acquisition.claim(leaseMs)?.sync.id).toBe('ready');
    expect(acquisition.claim(leaseMs)).toBeUndefined();
    acquisition.poll();
    expect(acquisition.claim(leaseMs)?.sync.id).toBe('succeeded');
    expect(acquisition.claim(leaseMs)).toBeUndefined();
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

test('failed migration rolls back all schema and data changes and can be retried', () => {
  const files = storage();
  let db = legacyDatabase(files.path);
  db.exec(
    "CREATE TRIGGER fail_migration BEFORE UPDATE ON syncs BEGIN SELECT RAISE(ABORT,'injected'); END",
  );
  const before = db.query('SELECT * FROM syncs ORDER BY id').all();
  db.close();
  try {
    expect(() => openDatabase(files.path)).toThrow();
    db = new Database(files.path);
    expect(db.query('SELECT * FROM syncs ORDER BY id').all()).toEqual(before);
    expect(db.query("SELECT name FROM pragma_table_info('syncs')").all()).not.toContainEqual({
      name: 'retry_at',
    });
    db.exec('DROP TRIGGER fail_migration');
    db.close();
    db = openDatabase(files.path);
    expect(db.query('SELECT id FROM syncs').all()).toHaveLength(before.length);
  } finally {
    db.close();
    files.close();
  }
});
