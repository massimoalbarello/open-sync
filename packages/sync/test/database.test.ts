import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { openDatabase } from '../src/db/client';
import { repositories, storage } from './support';

const preRetrySchemaVersion = 3;
const previousSchemaVersion = 4;
const futureSchemaVersion = 6;

test.each([1, 2, preRetrySchemaVersion, previousSchemaVersion, futureSchemaVersion])(
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
