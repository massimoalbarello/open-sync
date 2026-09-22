import type { Database } from 'bun:sqlite';
import type { QueueStatus } from '../models/delivery';
import type { Installation } from '../models/installation';
import type { QueueLimits } from '../models/limits';
import { assetBytes } from './assets/capacity';
export function queueUsage(input: {
  db: Database;
  ownerId?: string;
  installationId?: string;
}): QueueStatus {
  const row = input.db
    .query<QueueStatus, (string | null)[]>(`SELECT coalesce(sum(bytes),0) AS pendingBytes,
    coalesce(sum(record_count),0) AS pendingRecords,count(*) AS pendingDeliveries,
    coalesce(sum(state='blocked'),0) AS blockedDeliveries FROM deliveries WHERE (? IS NULL OR owner_id=?) AND (? IS NULL OR installation_id=?)`)
    .get(
      input.ownerId ?? null,
      input.ownerId ?? null,
      input.installationId ?? null,
      input.installationId ?? null,
    )!;
  return row;
}
export function hasQueueCapacity(input: {
  db: Database;
  limits: QueueLimits;
  installation?: Installation;
}): boolean {
  const usage = queueUsage({ db: input.db });
  const { limits, installation, db } = input;
  if (
    usage.pendingBytes >= limits.maxPendingBytes ||
    usage.pendingRecords >= limits.maxPendingRecords ||
    assetBytes({ db }) >= limits.maxPendingAssetBytes
  ) {
    return false;
  }
  if (!installation) {
    return true;
  }
  const own = queueUsage({ db, ownerId: installation.ownerId, installationId: installation.id });
  return (
    own.pendingBytes < limits.maxSyncPendingBytes &&
    own.pendingRecords < limits.maxSyncPendingRecords &&
    assetBytes({ db, ownerId: installation.ownerId, sourceId: installation.sourceId }) <
      limits.maxSyncAssetBytes
  );
}
