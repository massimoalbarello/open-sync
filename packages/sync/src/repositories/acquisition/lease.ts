import type { Database } from 'bun:sqlite';
import { definitionKey } from '../../models/definition';
import { fail } from '../../models/error';
import { workerScope } from '../../models/identity';
import type { Installation } from '../../models/installation';
import { readInstallation } from '../rows';
import type { RunLease } from './contract';
import { claimPoll, updatePoll } from './polls';

export function assertRun(input: { db: Database; lease: RunLease }): Installation {
  const { db, lease } = input;
  const valid = db
    .query(
      "SELECT 1 FROM runs WHERE owner_id=? AND id=? AND installation_id=? AND binding_epoch=? AND definition_ref=? AND state='running' AND worker_id=? AND generation=? AND expires_at>?",
    )
    .get(
      lease.ownerId,
      lease.id,
      lease.installation.id,
      lease.installation.bindingEpoch,
      definitionKey(lease.installation.definition),
      lease.workerId,
      lease.generation,
      Date.now(),
    );
  const installation = readInstallation({ db, scope: { ...lease, id: lease.installation.id } });
  if (
    !valid ||
    !installation.enabled ||
    installation.bindingEpoch !== lease.installation.bindingEpoch ||
    definitionKey(installation.definition) !== definitionKey(lease.installation.definition)
  ) {
    fail('lease_lost');
  }
  if (installation.checkpointRevision !== lease.checkpointRevision) {
    fail('checkpoint_conflict');
  }
  return installation;
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
          `SELECT id,owner_id,failure_count FROM installations i WHERE enabled=1 AND next_due_at<=?
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.owner_id=i.owner_id AND r.installation_id=i.id AND r.state='running')
          ORDER BY next_due_at,(SELECT COALESCE(MAX(rowid),0) FROM runs r WHERE r.owner_id=i.owner_id AND r.installation_id=i.id),id LIMIT 1`,
        )
        .get(Date.now());
      if (!row) {
        return;
      }
      const scope = workerScope(row.owner_id);
      const installation = readInstallation({ db, scope: { ...scope, id: row.id } });
      const pollId = claimPoll({ db, scope: { ...scope, id: row.id } });
      const lease: RunLease = {
        ...scope,
        id: `run_${crypto.randomUUID()}`,
        installation,
        workerId: crypto.randomUUID(),
        generation: 1,
        checkpointRevision: installation.checkpointRevision,
        failureCount: row.failure_count,
      };
      db.query(`INSERT INTO runs(owner_id,id,installation_id,definition_ref,binding_epoch,worker_id,generation,expires_at,state,started_at,poll_id)
      VALUES (?,?,?,?,?,?,?,?,'running',?,?)`).run(
        scope.ownerId,
        lease.id,
        installation.id,
        definitionKey(installation.definition),
        installation.bindingEpoch,
        lease.workerId,
        lease.generation,
        Date.now() + input.leaseMs,
        Date.now(),
        pollId,
      );
      db.query("UPDATE installations SET status='running' WHERE owner_id=? AND id=?").run(
        scope.ownerId,
        installation.id,
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
    .query(`UPDATE installations SET next_due_at=?,status='lease_expired' WHERE enabled=1 AND EXISTS (
    SELECT 1 FROM runs WHERE owner_id=installations.owner_id AND installation_id=installations.id AND state='running' AND expires_at<=?)`)
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
      'UPDATE installations SET status=?,next_due_at=?,failure_count=COALESCE(?,failure_count),enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE owner_id=? AND id=?',
    )
    .run(
      input.state,
      Date.now() + input.delay,
      input.failureCount ?? null,
      input.pause ? 1 : 0,
      input.lease.ownerId,
      input.lease.installation.id,
    );
}
