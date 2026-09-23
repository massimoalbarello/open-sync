import type { Database } from 'bun:sqlite';
import type { QueueStatus } from '../models/delivery';
import type { QueueLimits } from '../models/limits';
import { assetBytes } from './assets/capacity';
export function queueUsage(input: { db: Database; ownerId?: string }): QueueStatus {
  const row = input.db
    .query<QueueStatus, (string | null)[]>(`SELECT coalesce(sum(bytes),0) AS pendingBytes,
    coalesce(sum(record_count),0) AS pendingRecords,count(*) AS pendingDeliveries,
    coalesce(sum(state='blocked'),0) AS blockedDeliveries FROM deliveries WHERE (? IS NULL OR owner_id=?)`)
    .get(input.ownerId ?? null, input.ownerId ?? null)!;
  return row;
}
export function hasQueueCapacity({ db, limits }: { db: Database; limits: QueueLimits }): boolean {
  const usage = queueUsage({ db });
  return (
    usage.pendingBytes < limits.maxPendingBytes &&
    usage.pendingRecords < limits.maxPendingRecords &&
    assetBytes({ db }) < limits.maxPendingAssetBytes
  );
}
