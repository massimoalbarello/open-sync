import type { Database } from 'bun:sqlite';
import { fail } from '../../models/error';
import type { DeliveryLease } from './contract';

export function assertDelivery(input: { db: Database; lease: DeliveryLease }): void {
  const { db, lease } = input;
  if (
    !db
      .query(
        "SELECT 1 FROM deliveries WHERE owner_id=? AND id=? AND state='leased' AND worker_id=? AND generation=? AND expires_at>?",
      )
      .get(lease.ownerId, lease.delivery.id, lease.workerId, lease.generation, Date.now())
  ) {
    fail('lease_lost');
  }
}
