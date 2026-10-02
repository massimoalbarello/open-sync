import type { DatabaseSync } from 'node:sqlite';
import initialSchema from './migrations/0000-initial.sql' with { type: 'text' };
import centralizePolling from './migrations/0001-centralize-polling.sql' with { type: 'text' };

// Static imports keep migration history available in both installed packages and compiled hosts.
const migrations = [
  { name: '0000-initial.sql', sql: initialSchema },
  { name: '0001-centralize-polling.sql', sql: centralizePolling },
] as const;

export function runMigrations(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const applied = db.prepare('SELECT name FROM __migrations ORDER BY name').all();
    for (const [index, { name }] of applied.entries()) {
      if (name !== migrations[index]?.name) {
        throw new Error('Unsupported sync database migration history');
      }
    }
    for (const migration of migrations.slice(applied.length)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO __migrations (name,applied_at) VALUES (?,?)').run(
        migration.name,
        new Date().toISOString(),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}
