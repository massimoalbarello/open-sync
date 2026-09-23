import type { Database } from 'bun:sqlite';
import type { QueueStatus } from '../models/delivery';
import type { QueueLimits } from '../models/limits';
import type { Sync } from '../models/sync';
import { assetBytes } from './assets/capacity';
export function queueUsage(input: {
  db: Database;
  ownerId?: string;
  syncId?: string;
}): QueueStatus {
  const row = input.db
    .query<QueueStatus, (string | null)[]>(`SELECT coalesce(sum(bytes),0) AS pendingBytes,
    coalesce(sum(record_count),0) AS pendingRecords,count(*) AS pendingDeliveries,
    coalesce(sum(state='blocked'),0) AS blockedDeliveries FROM deliveries WHERE (? IS NULL OR owner_id=?) AND (? IS NULL OR sync_id=?)`)
    .get(input.ownerId ?? null, input.ownerId ?? null, input.syncId ?? null, input.syncId ?? null)!;
  return row;
}
export function hasQueueCapacity(input: {
  db: Database;
  limits: QueueLimits;
  sync?: Sync;
}): boolean {
  const usage = queueUsage({ db: input.db });
  const { limits, sync, db } = input;
  if (
    usage.pendingBytes >= limits.maxPendingBytes ||
    usage.pendingRecords >= limits.maxPendingRecords ||
    assetBytes({ db }) >= limits.maxPendingAssetBytes
  ) {
    return false;
  }
  if (!sync) {
    return true;
  }
  const own = queueUsage({ db, ownerId: sync.ownerId, syncId: sync.id });
  return (
    own.pendingBytes < limits.maxSyncPendingBytes &&
    own.pendingRecords < limits.maxSyncPendingRecords &&
    assetBytes({ db, ownerId: sync.ownerId, syncId: sync.id }) < limits.maxSyncAssetBytes
  );
}
