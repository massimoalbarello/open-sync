import type { Database } from 'bun:sqlite';
import { definitionKey } from '../../models/definition';
import { fail } from '../../models/error';
import { workerScope } from '../../models/identity';
import type { Installation } from '../../models/installation';
import { readInstallation } from '../rows';
import type { RunLease } from './contract';

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
      if (db.query("SELECT 1 FROM runs WHERE state='running'").get()) {
        return;
      }
      const row = db
        .query<{ id: string; owner_id: string }, [number]>(
          'SELECT id,owner_id FROM installations WHERE enabled=1 AND next_due_at<=? ORDER BY next_due_at,id LIMIT 1',
        )
        .get(Date.now());
      if (!row) {
        return;
      }
      const scope = workerScope(row.owner_id);
      const installation = readInstallation({ db, scope: { ...scope, id: row.id } });
      const lease: RunLease = {
        ...scope,
        id: `run_${crypto.randomUUID()}`,
        installation,
        workerId: crypto.randomUUID(),
        generation: 1,
        checkpointRevision: installation.checkpointRevision,
      };
      db.query(`INSERT INTO runs(owner_id,id,installation_id,definition_ref,binding_epoch,worker_id,generation,expires_at,checkpoint_revision,state,started_at)
      VALUES (?,?,?,?,?,?,?,?,?,'running',?)`).run(
        scope.ownerId,
        lease.id,
        installation.id,
        definitionKey(installation.definition),
        installation.bindingEpoch,
        lease.workerId,
        lease.generation,
        Date.now() + input.leaseMs,
        lease.checkpointRevision,
        Date.now(),
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
}
export function finishRun(input: {
  db: Database;
  lease: RunLease;
  state: string;
  delay: number;
}): void {
  input.db
    .query('UPDATE runs SET state=?,completed_at=? WHERE owner_id=? AND id=?')
    .run(input.state, Date.now(), input.lease.ownerId, input.lease.id);
  input.db
    .query('UPDATE installations SET status=?,next_due_at=? WHERE owner_id=? AND id=?')
    .run(input.state, Date.now() + input.delay, input.lease.ownerId, input.lease.installation.id);
}
