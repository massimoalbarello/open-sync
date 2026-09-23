import type { Database } from 'bun:sqlite';
import { fail } from '../../models/error';
import { workerScope } from '../../models/identity';
import type { Sync } from '../../models/sync';
import { readSync } from '../rows';
import type { AcquisitionRepository, RunLease } from './contract';

export function assertRun({ db, lease }: { db: Database; lease: RunLease }): Sync {
  const valid = db
    .query(`SELECT 1 FROM sync_runs r JOIN syncs s ON s.owner_id=r.owner_id AND s.id=r.sync_id
    WHERE r.owner_id=? AND r.id=? AND r.sync_id=? AND r.state='running' AND r.generation=? AND r.expires_at>? AND s.enabled=1`)
    .get(lease.ownerId, lease.id, lease.sync.id, lease.generation, Date.now());
  if (!valid) {
    fail('lease_lost');
  }
  return readSync({ db, scope: { ...lease, id: lease.sync.id } });
}

export function claimRun(input: {
  db: Database;
  leaseMs: number;
  historyLimit: number;
}): RunLease | undefined {
  const { db } = input;
  return db
    .transaction(() => {
      const now = Date.now();
      db.query(`UPDATE syncs SET next_due_at=?,status='interrupted',error_code='lease_expired' WHERE enabled=1 AND EXISTS (
      SELECT 1 FROM sync_runs WHERE owner_id=syncs.owner_id AND sync_id=syncs.id AND state='running' AND expires_at<=?)`).run(
        now,
        now,
      );
      db.query(`UPDATE sync_runs SET state='interrupted',expires_at=NULL,error_code='lease_expired'
      WHERE state='running' AND expires_at<=?`).run(now);
      db.query(`DELETE FROM sync_runs WHERE completed_at IS NOT NULL AND rowid NOT IN
      (SELECT rowid FROM sync_runs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC,rowid DESC LIMIT ?)`).run(
        input.historyLimit,
      );
      const row = db
        .query<
          { id: string; owner_id: string },
          [number]
        >(`SELECT id,owner_id FROM syncs s WHERE enabled=1 AND next_due_at<=?
      AND NOT EXISTS (SELECT 1 FROM sync_runs r WHERE r.owner_id=s.owner_id AND r.sync_id=s.id AND r.state='running')
      ORDER BY next_due_at,COALESCE((SELECT generation FROM sync_runs r WHERE r.owner_id=s.owner_id AND r.sync_id=s.id AND completed_at IS NULL),0),id LIMIT 1`)
        .get(now);
      if (!row) {
        return;
      }
      const scope = workerScope(row.owner_id);
      const sync = readSync({ db, scope: { ...scope, id: row.id } });
      const open = db
        .query<
          { id: string; generation: number; mode: string; failure_count: number },
          [string, string]
        >(
          'SELECT id,generation,mode,failure_count FROM sync_runs WHERE owner_id=? AND sync_id=? AND completed_at IS NULL',
        )
        .get(scope.ownerId, sync.id);
      const id = open?.id ?? `run_${crypto.randomUUID()}`;
      if (!open) {
        db.query(
          `INSERT INTO sync_runs(owner_id,id,sync_id,mode,state,started_at) VALUES (?,?,?,'incremental','ready',?)`,
        ).run(scope.ownerId, id, sync.id, now);
      }
      db.query(
        `UPDATE sync_runs SET state='running',generation=generation+1,expires_at=?,error_code=NULL WHERE owner_id=? AND id=?`,
      ).run(now + input.leaseMs, scope.ownerId, id);
      db.query(`UPDATE syncs SET status='running',error_code=NULL WHERE owner_id=? AND id=?`).run(
        scope.ownerId,
        sync.id,
      );
      return {
        ...scope,
        id,
        sync,
        generation: (open?.generation ?? 0) + 1,
        force: open?.mode === 'resync',
        failureCount: open?.failure_count ?? 0,
      };
    })
    .immediate();
}

export function finishRun(
  input: Parameters<AcquisitionRepository['finish']>[0] & { db: Database },
): void {
  const { db, lease } = input;
  db.query(
    `UPDATE sync_runs SET state=?,expires_at=NULL,completed_at=?,error_code=?,failure_count=COALESCE(?,failure_count) WHERE owner_id=? AND id=?`,
  ).run(
    input.pause ? 'paused' : input.state,
    input.state === 'succeeded' ? Date.now() : null,
    input.errorCode ?? null,
    input.failureCount ?? null,
    lease.ownerId,
    lease.id,
  );
  db.query(
    `UPDATE syncs SET status=?,error_code=?,next_due_at=?,enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE owner_id=? AND id=?`,
  ).run(
    input.pause ? 'disabled' : input.state,
    input.errorCode ?? null,
    Date.now() + input.delay,
    Number(input.pause ?? false),
    lease.ownerId,
    lease.sync.id,
  );
}
