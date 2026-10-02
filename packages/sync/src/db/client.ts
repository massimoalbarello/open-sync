import { Database } from 'bun:sqlite';
import schema from './schema.sql' with { type: 'text' };

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    db.transaction(() => {
      db.exec(schema);
      const columns = db.query<{ name: string }, []>('PRAGMA table_info(syncs)').all();
      if (columns.some(({ name }) => name === 'interval_ms')) {
        // Execute separately so an intermediate failure aborts the entire migration.
        db.query('ALTER TABLE syncs ADD COLUMN retry_at INTEGER').run();
        db.query(`UPDATE syncs SET retry_at=next_due_at
          WHERE status IN ('retrying','interrupted','waiting_for_capacity')`).run();
        db.query('ALTER TABLE syncs DROP COLUMN interval_ms').run();
        db.query('ALTER TABLE syncs DROP COLUMN next_due_at').run();
      }
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
