import type { Database } from 'bun:sqlite';
import type { Resource } from '../../models/identity';
import type { SyncRun } from '../../models/sync';

export function readRuns({ db, scope }: { db: Database; scope: Resource & { offset: number } }) {
  const pageSize = 50;
  const rows = db
    .query<SyncRun, [string, string, number, number]>(`SELECT id,mode,state,error_code AS errorCode,
    started_at AS startedAt,completed_at AS completedAt,records_processed AS recordsProcessed,records_queued AS recordsQueued
    FROM sync_runs WHERE owner_id=? AND sync_id=? ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?`)
    .all(scope.ownerId, scope.id, pageSize + 1, scope.offset);
  return { runs: rows.slice(0, pageSize), hasMore: rows.length > pageSize, pageSize };
}
