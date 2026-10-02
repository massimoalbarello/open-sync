import type { Database } from 'bun:sqlite';
import initialSchema from './migrations/0000-initial.sql' with { type: 'text' };
import centralizePolling from './migrations/0001-centralize-polling.sql' with { type: 'text' };

// Static imports keep migration history available in both installed packages and compiled hosts.
const migrations = [
  { name: '0000-initial.sql', sql: initialSchema },
  { name: '0001-centralize-polling.sql', sql: centralizePolling },
] as const;

export function runMigrations(db: Database): void {
  db.transaction(() => {
    db.query(`CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`).run();
    const applied = db
      .query<{ name: string }, []>('SELECT name FROM __migrations ORDER BY name')
      .all();
    for (const [index, { name }] of applied.entries()) {
      if (name !== migrations[index]?.name) {
        throw new Error('Unsupported sync database migration history');
      }
    }
    for (const migration of migrations.slice(applied.length)) {
      executeSql({ db, sql: migration.sql });
      db.query('INSERT INTO __migrations (name,applied_at) VALUES (?,?)').run(
        migration.name,
        new Date().toISOString(),
      );
    }
  }).immediate();
}

export function executeSql({ db, sql }: { db: Database; sql: string }): void {
  // Bun 1.4's exec() can hide failures in non-final statements. Let SQLite parse each
  // statement instead, preserving trigger bodies, comments and quoted semicolons.
  // A final no-op also lets prepare() consume files ending in comments or whitespace.
  let remaining = `${sql}\n;SELECT 1;`;
  while (remaining.length) {
    using statement = db.prepare(remaining);
    const parsed = statement.toString();
    if (!parsed || !remaining.startsWith(parsed)) {
      throw new Error('Migration SQL must contain complete statements without parameters');
    }
    statement.run();
    remaining = remaining.slice(parsed.length);
  }
}
