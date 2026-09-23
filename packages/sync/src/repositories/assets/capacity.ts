import type { Database } from 'bun:sqlite';
import type { AcquisitionLease } from '../acquisition/contract';

export function assetBytes(input: { db: Database; lease?: AcquisitionLease }): number {
  return input.db
    .query<{ bytes: number }, (string | number | null)[]>(
      `SELECT COALESCE(SUM(bytes),0) AS bytes FROM delivery_assets
      WHERE (? IS NULL OR (owner_id=? AND sync_id=? AND generation=?))`,
    )
    .get(
      input.lease?.ownerId ?? null,
      input.lease?.ownerId ?? null,
      input.lease?.sync.id ?? null,
      input.lease?.generation ?? null,
    )!.bytes;
}
