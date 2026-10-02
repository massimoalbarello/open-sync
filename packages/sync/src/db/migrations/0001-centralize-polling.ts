import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.query('ALTER TABLE syncs ADD COLUMN retry_at INTEGER').run();
  db.query(`UPDATE syncs SET retry_at=next_due_at
    WHERE status IN ('retrying','interrupted','waiting_for_capacity')`).run();
  db.query('ALTER TABLE syncs DROP COLUMN interval_ms').run();
  db.query('ALTER TABLE syncs DROP COLUMN next_due_at').run();
}
