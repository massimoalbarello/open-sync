import type { Database } from 'bun:sqlite';
import type { Resource } from '../../models/identity';
import type { SyncPoll, SyncRun } from '../../models/installation';

const pageSize = 50;
interface RunRow {
  id: string;
  state: string;
  started_at: number;
  completed_at: number | null;
  pages: number;
  checkpoint_revision: number;
  records_processed: number | null;
  records_changed: number | null;
}
function run(row: RunRow): SyncRun {
  return {
    id: row.id,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    pages: row.pages,
    checkpointRevision: row.checkpoint_revision,
    recordsProcessed: row.records_processed,
    recordsChanged: row.records_changed,
  };
}
export function readRuns(input: { db: Database; scope: Resource & { offset: number } }) {
  const { db, scope } = input;
  const rows = db
    .query<RunRow, [string, string, number, number]>(
      'SELECT * FROM runs WHERE owner_id=? AND installation_id=? ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?',
    )
    .all(scope.ownerId, scope.id, pageSize + 1, scope.offset);
  return { runs: rows.slice(0, pageSize).map(run), hasMore: rows.length > pageSize, pageSize };
}

interface PollRow extends Omit<RunRow, 'pages' | 'checkpoint_revision'> {
  attempt_count: number;
  legacy: number;
}
export function readPolls(input: { db: Database; scope: Resource & { offset: number } }) {
  const { db, scope } = input;
  const rows = db
    .query<PollRow, [string, string, string, string, number, number]>(`
    SELECT id,state,started_at,completed_at,records_processed,records_changed,attempt_count,0 AS legacy
      FROM polls WHERE owner_id=? AND installation_id=?
    UNION ALL
    SELECT id,state,started_at,completed_at,NULL,NULL,1,1
      FROM runs WHERE owner_id=? AND installation_id=? AND poll_id IS NULL
    ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?
  `)
    .all(scope.ownerId, scope.id, scope.ownerId, scope.id, pageSize + 1, scope.offset);
  const polls: SyncPoll[] = rows.slice(0, pageSize).map((row) => ({
    id: row.id,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    recordsProcessed: row.records_processed,
    recordsChanged: row.records_changed,
    attemptCount: row.attempt_count,
    legacy: row.legacy === 1,
    attempts: db
      .query<RunRow, [string, string, string, number]>(
        `SELECT * FROM runs WHERE owner_id=? AND installation_id=? AND ${row.legacy ? 'id' : 'poll_id'}=?
       ORDER BY started_at DESC,rowid DESC LIMIT ?`,
      )
      .all(scope.ownerId, scope.id, row.id, pageSize)
      .map(run),
  }));
  return { polls, hasMore: rows.length > pageSize, pageSize };
}
