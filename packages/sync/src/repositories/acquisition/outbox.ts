import type { Database } from 'bun:sqlite';
import type { DeliveryAsset } from '../../models/asset';
import type { Deliverable, DeliveredRecord } from '../../models/delivery';
import { fail } from '../../models/error';
import { canonicalJson } from '../../models/json';
import type { QueueLimits } from '../../models/limits';
import type { Sync } from '../../models/sync';
import { queueUsage } from '../queue-usage';
import type { AcquisitionLease } from './contract';

export function enqueue(input: {
  db: Database;
  sync: Sync;
  records: DeliveredRecord[];
  limits: QueueLimits;
  assets: DeliveryAsset[];
  lease: AcquisitionLease;
}): void {
  if (!input.records.length) {
    return;
  }
  const { sync, db, limits } = input;
  const { assets } = input;
  const delivery: Omit<Deliverable, 'openAsset'> = {
    id: `delivery_${crypto.randomUUID()}`,
    ownerId: sync.ownerId,
    syncId: sync.id,
    definition: sync.definition,
    records: input.records,
    assets,
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
    'INSERT INTO deliveries(owner_id,id,sync_id,body,bytes,record_count,due_at) VALUES (?,?,?,?,?,?,?)',
  ).run(sync.ownerId, delivery.id, sync.id, body, bytes, input.records.length, Date.now());
  for (const asset of assets) {
    db.query(
      `UPDATE delivery_assets SET delivery_id=? WHERE owner_id=? AND sync_id=? AND generation=? AND asset_id=? AND asset_version=?`,
    ).run(delivery.id, sync.ownerId, sync.id, input.lease.generation, asset.id, asset.version);
  }
}
