import type { Database } from 'bun:sqlite';
import type { DeliveryResult, PendingDelivery } from '../../models/delivery';
import { fail } from '../../models/error';
import { type Resource, type Scope, workerScope } from '../../models/identity';
import { queueUsage } from '../queue-usage';
import { type Row, readDestination } from '../rows';
import type { DeliveryLease, DeliveryRepository } from './contract';
import { assertDelivery } from './lease';

export class SqliteDeliveries implements DeliveryRepository {
  constructor(private readonly db: Database) {}
  claim(leaseMs: number): DeliveryLease | undefined {
    return this.db
      .transaction(() => {
        // A blocked delivery stops only its destination; ordering survives retries and restarts.
        const row = this.db
          .query<
            Row,
            [number, number]
          >(`SELECT d.* FROM deliveries d WHERE d.state!='blocked' AND d.due_at<=?
        AND (d.state='pending' OR d.expires_at<=?) AND NOT EXISTS (
          SELECT 1 FROM deliveries prior WHERE prior.owner_id=d.owner_id AND prior.destination_id=d.destination_id AND prior.sequence<d.sequence)
        ORDER BY d.sequence LIMIT 1`)
          .get(Date.now(), Date.now());
        if (!row) {
          return;
        }
        const workerId = crypto.randomUUID();
        const scope = workerScope(String(row.owner_id));
        this.db
          .query(
            "UPDATE deliveries SET state='leased',worker_id=?,generation=generation+1,attempt=attempt+1,expires_at=? WHERE owner_id=? AND id=?",
          )
          .run(workerId, Date.now() + leaseMs, scope.ownerId, row.id!);
        return {
          ...scope,
          delivery: JSON.parse(String(row.body)),
          destination: readDestination({
            db: this.db,
            scope: { ...scope, id: String(row.destination_id) },
          }),
          workerId,
          generation: Number(row.generation) + 1,
          attempt: Number(row.attempt) + 1,
        };
      })
      .immediate();
  }
  complete(input: { lease: DeliveryLease; result: DeliveryResult; delay: number }): void {
    const { lease, result } = input;
    this.db
      .transaction(() => {
        assertDelivery({ db: this.db, lease });
        if (result.status === 'accepted') {
          this.db
            .query('DELETE FROM deliveries WHERE owner_id=? AND id=?')
            .run(lease.ownerId, lease.delivery.id);
          // Capacity is global; all paused acquisitions can compete for the released budget.
          this.db
            .query(
              "UPDATE installations SET next_due_at=? WHERE enabled=1 AND status='waiting_for_capacity'",
            )
            .run(Date.now());
        } else {
          this.db
            .query(
              'UPDATE deliveries SET state=?,due_at=?,worker_id=NULL,expires_at=NULL,error_code=? WHERE owner_id=? AND id=?',
            )
            .run(
              result.status === 'rejected' ? 'blocked' : 'pending',
              Date.now() + input.delay,
              result.code ?? null,
              lease.ownerId,
              lease.delivery.id,
            );
        }
      })
      .immediate();
  }
  status(scope: Scope) {
    return queueUsage({ db: this.db, ownerId: scope.ownerId });
  }
  pending(input: Scope & { offset: number }) {
    const limit = 50;
    const rows = this.db
      .query<
        PendingDelivery,
        [string, number, number]
      >(`SELECT id,installation_id AS installationId,destination_id AS destinationId,state,bytes,
      record_count AS recordCount,attempt,due_at AS nextAttemptAt,error_code AS errorCode FROM deliveries WHERE owner_id=? ORDER BY sequence LIMIT ? OFFSET ?`)
      .all(input.ownerId, limit + 1, input.offset);
    return { deliveries: rows.slice(0, limit), hasMore: rows.length > limit, pageSize: limit };
  }
  retry(input: Resource): void {
    const updated = this.db
      .query(
        "UPDATE deliveries SET state='pending',due_at=?,generation=generation+1,worker_id=NULL,expires_at=NULL,error_code=NULL WHERE owner_id=? AND id=?",
      )
      .run(Date.now(), input.ownerId, input.id);
    if (!updated.changes) {
      fail('not_found');
    }
  }
}
