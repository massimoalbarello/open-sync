import type { Database } from 'bun:sqlite';
import type { DeliveredRecord, Delivery } from '../../models/delivery';
import { fail } from '../../models/error';
import type { Installation } from '../../models/installation';
import { canonicalJson } from '../../models/json';
import type { QueueLimits } from '../../models/limits';
import { queueUsage } from '../queue-usage';

export function enqueue(input: {
  db: Database;
  installation: Installation;
  records: DeliveredRecord[];
  limits: QueueLimits;
}): void {
  if (!input.records.length) {
    return;
  }
  const { installation, db, limits } = input;
  const delivery: Delivery = {
    version: 1,
    id: `delivery_${crypto.randomUUID()}`,
    ownerId: installation.ownerId,
    sourceId: installation.sourceId,
    installationId: installation.id,
    definition: installation.definition,
    deliverable: { records: input.records },
  };
  const body = canonicalJson(delivery).json;
  const bytes = Buffer.byteLength(body);
  if (bytes > limits.maxPendingBytes || input.records.length > limits.maxPendingRecords) {
    fail('page_exceeds_queue_capacity');
  }
  const usage = queueUsage({ db });
  if (
    bytes + usage.pendingBytes > limits.maxPendingBytes ||
    input.records.length + usage.pendingRecords > limits.maxPendingRecords
  ) {
    fail('waiting_for_capacity');
  }
  db.query(
    'INSERT INTO deliveries(owner_id,id,installation_id,destination_id,body,bytes,record_count,due_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    installation.ownerId,
    delivery.id,
    installation.id,
    installation.destinationId,
    body,
    bytes,
    input.records.length,
    Date.now(),
  );
}
