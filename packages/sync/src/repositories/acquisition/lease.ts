import type { Database } from 'bun:sqlite';
import { fail } from '../../models/error';
import { workerScope } from '../../models/identity';
import type { Sync } from '../../models/sync';
import { readSync } from '../rows';
import type { AcquisitionLease, AcquisitionRepository } from './contract';

export function assertAcquisition({ db, lease }: { db: Database; lease: AcquisitionLease }): Sync {
  const valid = db
    .query(`SELECT 1 FROM syncs WHERE owner_id=? AND id=? AND enabled=1
      AND status='running' AND generation=? AND expires_at>?`)
    .get(lease.ownerId, lease.sync.id, lease.generation, Date.now());
  if (!valid) {
    fail('lease_lost');
  }
  return readSync({ db, scope: { ...lease, id: lease.sync.id } });
}

export function claimAcquisition({
  db,
  leaseMs,
}: {
  db: Database;
  leaseMs: number;
}): AcquisitionLease | undefined {
  return db
    .transaction(() => {
      const now = Date.now();
      db.query(`UPDATE syncs SET next_due_at=?,status='interrupted',error_code='lease_expired',expires_at=NULL
      WHERE enabled=1 AND expires_at<=?`).run(now, now);
      const row = db
        .query<
          {
            id: string;
            owner_id: string;
            generation: number;
            resync: number;
            failure_count: number;
          },
          [number]
        >(`SELECT id,owner_id,generation,resync,failure_count FROM syncs
      WHERE enabled=1 AND expires_at IS NULL AND next_due_at<=?
      ORDER BY next_due_at,generation,id LIMIT 1`)
        .get(now);
      if (!row) {
        return;
      }
      const scope = workerScope(row.owner_id);
      db.query(`UPDATE syncs SET status='running',error_code=NULL,generation=generation+1,expires_at=?
      WHERE owner_id=? AND id=?`).run(now + leaseMs, scope.ownerId, row.id);
      return {
        ...scope,
        sync: readSync({ db, scope: { ...scope, id: row.id } }),
        generation: row.generation + 1,
        force: row.resync === 1,
        failureCount: row.failure_count,
      };
    })
    .immediate();
}

export function finishAcquisition(
  input: Parameters<AcquisitionRepository['finish']>[0] & { db: Database },
): void {
  const { db, lease } = input;
  db.query(`UPDATE syncs SET status=?,error_code=?,next_due_at=?,expires_at=NULL,
    enabled=CASE WHEN ? THEN 0 ELSE enabled END,
    failure_count=COALESCE(?,failure_count),resync=CASE WHEN ? THEN 0 ELSE resync END
    WHERE owner_id=? AND id=?`).run(
    input.pause ? 'disabled' : input.state,
    input.errorCode ?? null,
    Date.now() + input.delay,
    Number(input.pause ?? false),
    input.failureCount ?? null,
    Number(input.state === 'succeeded'),
    lease.ownerId,
    lease.sync.id,
  );
}
