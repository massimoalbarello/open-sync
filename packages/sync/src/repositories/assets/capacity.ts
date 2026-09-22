import type { Database } from 'bun:sqlite';

export function assetBytes(input: {
  db: Database;
  ownerId?: string;
  sourceId?: string;
  runId?: string;
}): number {
  return input.db
    .query<{ bytes: number }, (string | null)[]>(
      `SELECT COALESCE(SUM(bytes),0) AS bytes FROM asset_files
    WHERE (? IS NULL OR owner_id=?) AND (? IS NULL OR source_id=?) AND (? IS NULL OR run_id=?)`,
    )
    .get(
      input.ownerId ?? null,
      input.ownerId ?? null,
      input.sourceId ?? null,
      input.sourceId ?? null,
      input.runId ?? null,
      input.runId ?? null,
    )!.bytes;
}
