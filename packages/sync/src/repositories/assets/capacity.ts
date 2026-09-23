import type { Database } from 'bun:sqlite';

export function assetBytes(input: {
  db: Database;
  ownerId?: string;
  syncId?: string;
  runId?: string;
  generation?: number;
}): number {
  return input.db
    .query<{ bytes: number }, (string | number | null)[]>(
      `SELECT COALESCE(SUM(bytes),0) AS bytes FROM delivery_assets
    WHERE (? IS NULL OR owner_id=?) AND (? IS NULL OR sync_id=?) AND (? IS NULL OR run_id=?) AND (? IS NULL OR generation=?)`,
    )
    .get(
      input.ownerId ?? null,
      input.ownerId ?? null,
      input.syncId ?? null,
      input.syncId ?? null,
      input.runId ?? null,
      input.runId ?? null,
      input.generation ?? null,
      input.generation ?? null,
    )!.bytes;
}
