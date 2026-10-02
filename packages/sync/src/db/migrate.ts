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
      // Explicit boundaries also support triggers and strings containing semicolons.
      // Executing each statement separately surfaces errors hidden by Bun 1.4 SQL batches.
      for (const statement of migration.sql.split('--> statement-breakpoint')) {
        db.query(statement).run();
      }
      db.query('INSERT INTO __migrations (name,applied_at) VALUES (?,?)').run(
        migration.name,
        new Date().toISOString(),
      );
    }
  }).immediate();
}
