import type { Database } from 'bun:sqlite';
import { up as initialSchema } from './migrations/0000-initial-schema';
import { up as centralizePolling } from './migrations/0001-centralize-polling';

// Static imports keep migration history available in both installed packages and compiled hosts.
const migrations = [
  { name: '0000-initial-schema', up: initialSchema },
  { name: '0001-centralize-polling', up: centralizePolling },
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
      migration.up(db);
      db.query('INSERT INTO __migrations (name,applied_at) VALUES (?,?)').run(
        migration.name,
        new Date().toISOString(),
      );
    }
  }).immediate();
}
