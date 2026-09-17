import type { Database } from 'bun:sqlite';
import type { QueueStatus } from '../models/delivery';
import type { QueueLimits } from '../models/limits';
export function queueUsage(input: { db: Database; ownerId?: string }): QueueStatus {
  const row = input.db
    .query<
      QueueStatus,
      [string | null, string | null]
    >(`SELECT coalesce(sum(bytes),0) AS pendingBytes,
    coalesce(sum(record_count),0) AS pendingRecords,count(*) AS pendingDeliveries,
    coalesce(sum(state='blocked'),0) AS blockedDeliveries FROM deliveries WHERE (? IS NULL OR owner_id=?)`)
    .get(input.ownerId ?? null, input.ownerId ?? null)!;
  return row;
}
export function hasQueueCapacity(input: { db: Database; limits: QueueLimits }): boolean {
  const usage = queueUsage({ db: input.db });
  return (
    usage.pendingBytes < input.limits.maxPendingBytes &&
    usage.pendingRecords < input.limits.maxPendingRecords
  );
}
