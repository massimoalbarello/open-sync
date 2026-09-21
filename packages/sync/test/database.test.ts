import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import { alpha, fixture, page, repositories, storage } from './support';

const futureSchemaVersion = 5;

test('version 3 upgrades atomically without changing checkpoints, history or queued deliveries', () => {
  const f = repositories();
  try {
    const leaseMs = 60_000;
    const lease = f.acquisition.claim(leaseMs)!;
    f.acquisition.commit({ lease, page, definition: fixture.definition });
    f.acquisition.finish({ lease, state: 'connector_request_failed', delay: leaseMs });
    // Recreate the exact previous installation shape with populated related tables.
    f.db.exec('ALTER TABLE installations DROP COLUMN failure_count; PRAGMA user_version=3');
    const saved = f.catalog.installation({ ...alpha, id: f.installation.id });
    const tables = ['definitions', 'destinations', 'polls', 'runs', 'records', 'deliveries'];
    const rows = tables.map((table) => f.db.query(`SELECT * FROM ${table}`).all());
    const upgraded = openDatabase(f.files.path);
    upgraded.close();
    expect(f.catalog.installation({ ...alpha, id: f.installation.id })).toEqual(saved);
    expect(tables.map((table) => f.db.query(`SELECT * FROM ${table}`).all())).toEqual(rows);
    expect(f.db.query('SELECT failure_count FROM installations').get()).toEqual({
      failure_count: 0,
    });
    expect(f.db.query('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    openDatabase(f.files.path).close();
  } finally {
    f.close();
  }
});

test('a failed version 3 upgrade rolls back its schema version and preserves data', () => {
  const files = storage();
  const db = new Database(files.path);
  try {
    db.exec('PRAGMA user_version=3; CREATE TABLE preserved (value TEXT)');
    db.query('INSERT INTO preserved VALUES (?)').run('keep');
    expect(() => openDatabase(files.path)).toThrow();
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(db.query('SELECT * FROM preserved').all()).toEqual([{ value: 'keep' }]);
  } finally {
    db.close();
    files.close();
  }
});

test.each([1, 2, futureSchemaVersion])(
  'schema version %i is rejected without upgrading or deleting data',
  (version) => {
    const files = storage();
    const db = new Database(files.path);
    try {
      db.exec(`PRAGMA user_version=${version}; CREATE TABLE preserved (value TEXT NOT NULL)`);
      db.query('INSERT INTO preserved VALUES (?)').run('keep this data');
      expect(() => openDatabase(files.path)).toThrow('Start with a fresh database.');
      expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: version });
      expect(db.query('SELECT value FROM preserved').all()).toEqual([{ value: 'keep this data' }]);
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
        { name: 'preserved' },
      ]);
    } finally {
      db.close();
      files.close();
    }
  },
);

test('every attempt requires a poll and recorded counts', () => {
  const f = repositories();
  try {
    const leaseMs = 60_000;
    f.acquisition.claim(leaseMs);
    for (const column of ['poll_id', 'records_processed', 'records_changed']) {
      expect(() => f.db.exec(`UPDATE runs SET ${column}=NULL`)).toThrow('NOT NULL');
    }
    expect(() => f.db.exec("UPDATE runs SET poll_id='missing'")).toThrow('FOREIGN KEY');
    expect(f.db.query('SELECT records_processed,records_changed FROM runs').get()).toEqual({
      records_processed: 0,
      records_changed: 0,
    });
  } finally {
    f.close();
  }
});
