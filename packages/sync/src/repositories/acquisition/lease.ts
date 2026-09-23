import type { Database } from 'bun:sqlite';
import { fail } from '../../models/error';
import { workerScope } from '../../models/identity';
import type { Sync } from '../../models/sync';
import { readSync } from '../rows';
import type { RunLease } from './contract';
import { claimPoll, updatePoll } from './polls';

export function assertRun(input: { db: Database; lease: RunLease }): Sync {
  const { db, lease } = input;
  const valid = db
    .query(
      "SELECT 1 FROM runs WHERE owner_id=? AND id=? AND sync_id=? AND binding_epoch=? AND state='running' AND worker_id=? AND generation=? AND expires_at>?",
    )
    .get(
      lease.ownerId,
      lease.id,
      lease.sync.id,
      lease.sync.bindingEpoch,
      lease.workerId,
      lease.generation,
      Date.now(),
    );
  const sync = readSync({ db, scope: { ...lease, id: lease.sync.id } });
  if (!valid || !sync.enabled || sync.bindingEpoch !== lease.sync.bindingEpoch) {
    fail('lease_lost');
  }
  if (sync.checkpointRevision !== lease.checkpointRevision) {
    fail('checkpoint_conflict');
  }
  return sync;
}
export function claimRun(input: {
  db: Database;
  leaseMs: number;
  historyLimit: number;
}): RunLease | undefined {
  const { db } = input;
  return db
    .transaction(() => {
      recoverRuns(input);
      const row = db
        .query<{ id: string; owner_id: string; failure_count: number }, [number]>(
          `SELECT id,owner_id,failure_count FROM syncs i WHERE enabled=1 AND next_due_at<=?
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.owner_id=i.owner_id AND r.sync_id=i.id AND r.state='running')
          ORDER BY next_due_at,(SELECT COALESCE(MAX(rowid),0) FROM runs r WHERE r.owner_id=i.owner_id AND r.sync_id=i.id),id LIMIT 1`,
        )
        .get(Date.now());
      if (!row) {
        return;
      }
      const scope = workerScope(row.owner_id);
      const sync = readSync({ db, scope: { ...scope, id: row.id } });
      const pollId = claimPoll({ db, scope: { ...scope, id: row.id } });
      const lease: RunLease = {
        ...scope,
        id: `run_${crypto.randomUUID()}`,
        sync,
        workerId: crypto.randomUUID(),
        generation: 1,
        checkpointRevision: sync.checkpointRevision,
        failureCount: row.failure_count,
      };
      db.query(`INSERT INTO runs(owner_id,id,sync_id,binding_epoch,worker_id,generation,expires_at,state,started_at,poll_id)
      VALUES (?,?,?,?,?,?,?,'running',?,?)`).run(
        scope.ownerId,
        lease.id,
        sync.id,
        sync.bindingEpoch,
        lease.workerId,
        lease.generation,
        Date.now() + input.leaseMs,
        Date.now(),
        pollId,
      );
      db.query("UPDATE syncs SET status='running' WHERE owner_id=? AND id=?").run(
        scope.ownerId,
        sync.id,
      );
      return lease;
    })
    .immediate();
}
function recoverRuns(input: { db: Database; historyLimit: number }): void {
  input.db
    .query(`UPDATE polls SET state='interrupted' WHERE completed_at IS NULL AND EXISTS (
    SELECT 1 FROM runs WHERE owner_id=polls.owner_id AND poll_id=polls.id AND state='running' AND expires_at<=?)`)
    .run(Date.now());
  input.db
    .query(`UPDATE syncs SET next_due_at=?,status='lease_expired' WHERE enabled=1 AND EXISTS (
    SELECT 1 FROM runs WHERE owner_id=syncs.owner_id AND sync_id=syncs.id AND state='running' AND expires_at<=?)`)
    .run(Date.now(), Date.now());
  input.db
    .query(
      "UPDATE runs SET state='lease_expired',completed_at=? WHERE state='running' AND expires_at<=?",
    )
    .run(Date.now(), Date.now());
  input.db
    .query(
      "DELETE FROM runs WHERE state!='running' AND rowid NOT IN (SELECT rowid FROM runs ORDER BY started_at DESC,rowid DESC LIMIT ?)",
    )
    .run(input.historyLimit);
  input.db
    .query(`DELETE FROM polls WHERE completed_at IS NOT NULL
    AND rowid NOT IN (SELECT rowid FROM polls ORDER BY started_at DESC,rowid DESC LIMIT ?)
    AND NOT EXISTS (SELECT 1 FROM runs WHERE owner_id=polls.owner_id AND poll_id=polls.id)`)
    .run(input.historyLimit);
}
export function finishRun(input: {
  db: Database;
  lease: RunLease;
  state: string;
  delay: number;
  failureCount?: number;
  pause?: boolean;
}): void {
  updatePoll({
    db: input.db,
    ownerId: input.lease.ownerId,
    runId: input.lease.id,
    state: input.pause ? 'paused' : input.state,
  });
  input.db
    .query('UPDATE runs SET state=?,completed_at=? WHERE owner_id=? AND id=?')
    .run(input.state, Date.now(), input.lease.ownerId, input.lease.id);
  input.db
    .query(
      'UPDATE syncs SET status=?,next_due_at=?,failure_count=COALESCE(?,failure_count),enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE owner_id=? AND id=?',
    )
    .run(
      input.state,
      Date.now() + input.delay,
      input.failureCount ?? null,
      input.pause ? 1 : 0,
      input.lease.ownerId,
      input.lease.sync.id,
    );
}
