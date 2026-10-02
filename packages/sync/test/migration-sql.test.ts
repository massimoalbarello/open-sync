import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { executeSql } from '../src/db/migrate';

test('migration SQL uses SQLite statement boundaries, including triggers, strings and comments', () => {
  using db = new Database(':memory:');
  executeSql({
    db,
    sql: `
    -- A comment containing a semicolon ;
    CREATE TABLE records(value TEXT);
    CREATE TABLE audit(value TEXT);
    CREATE TRIGGER record_added AFTER INSERT ON records BEGIN
      INSERT INTO audit VALUES ('first; value');
      INSERT INTO audit VALUES (NEW.value);
    END;
    /* Another ; comment */
    INSERT INTO records VALUES ('雪; it''s saved');
    INSERT INTO records VALUES ('second')
    -- A trailing comment without a newline`,
  });
  expect(db.query('SELECT value FROM audit').all()).toEqual([
    { value: 'first; value' },
    { value: "雪; it's saved" },
    { value: 'first; value' },
    { value: 'second' },
  ]);
});

test('parameterized or invalid migration SQL fails and rolls back prior statements', () => {
  using db = new Database(':memory:');
  for (const invalid of ['INSERT INTO records VALUES (?)', 'invalid syntax']) {
    expect(() =>
      db
        .transaction(() => executeSql({ db, sql: `CREATE TABLE records(value TEXT); ${invalid}` }))
        .immediate(),
    ).toThrow();
    expect(db.query('SELECT name FROM sqlite_schema').all()).toEqual([]);
  }
});
