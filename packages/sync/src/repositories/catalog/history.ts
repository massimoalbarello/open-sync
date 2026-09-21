import type { Database } from 'bun:sqlite';
import type { Resource } from '../../models/identity';
import type { SyncAttempt, SyncPoll } from '../../models/installation';

const pageSize = 50;
interface AttemptRow {
  id: string;
  state: string;
  started_at: number;
  completed_at: number | null;
  records_processed: number;
  records_changed: number;
}
function attempt(row: AttemptRow): SyncAttempt {
  return {
    id: row.id,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    recordsProcessed: row.records_processed,
    recordsChanged: row.records_changed,
  };
}
interface PollRow extends AttemptRow {
  attempt_count: number;
}
export function readPolls(input: { db: Database; scope: Resource & { offset: number } }) {
  const { db, scope } = input;
  const rows = db
    .query<PollRow, [string, string, number, number]>(`
    SELECT * FROM polls WHERE owner_id=? AND installation_id=?
    ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?
  `)
    .all(scope.ownerId, scope.id, pageSize + 1, scope.offset);
  const polls: SyncPoll[] = rows.slice(0, pageSize).map((row) => ({
    ...attempt(row),
    attemptCount: row.attempt_count,
    attempts: db
      .query<AttemptRow, [string, string, string, number]>(
        `SELECT * FROM runs WHERE owner_id=? AND installation_id=? AND poll_id=?
       ORDER BY started_at DESC,rowid DESC LIMIT ?`,
      )
      .all(scope.ownerId, scope.id, row.id, pageSize)
      .map(attempt),
  }));
  return { polls, hasMore: rows.length > pageSize, pageSize };
}
