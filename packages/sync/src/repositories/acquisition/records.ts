import type { Database } from 'bun:sqlite';
import type { DeliveryAsset } from '../../models/asset';
import type { DeliveredRecord } from '../../models/delivery';
import { canonicalJson } from '../../models/json';
import type { SyncRecord } from '../../models/record';
import type { Sync } from '../../models/sync';

export function writeRecord(input: {
  db: Database;
  sync: Sync;
  record: SyncRecord;
  assets: DeliveryAsset[];
  force: boolean;
}): DeliveredRecord | undefined {
  const { db, sync, record } = input;
  const previous = db
    .query<{ hash: string; revision: number; deleted: number }, [string, string, string, string]>(
      'SELECT hash,revision,deleted FROM record_state WHERE owner_id=? AND sync_id=? AND kind=? AND id=?',
    )
    .get(sync.ownerId, sync.id, record.kind, record.id);
  if (!input.force && record.operation === 'delete' && (!previous || previous.deleted === 1)) {
    return;
  }
  const contentHash =
    record.operation === 'upsert'
      ? hashRecord({ record, assets: input.assets })
      : (previous?.hash ?? '');
  if (
    !input.force &&
    record.operation === 'upsert' &&
    previous?.deleted === 0 &&
    previous.hash === contentHash
  ) {
    return;
  }
  const revision = (previous?.revision ?? 0) + 1;
  db.query(`INSERT INTO record_state VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,sync_id,kind,id)
    DO UPDATE SET hash=excluded.hash,revision=excluded.revision,deleted=excluded.deleted`).run(
    sync.ownerId,
    sync.id,
    record.kind,
    record.id,
    contentHash,
    revision,
    Number(record.operation === 'delete'),
  );
  return { ...record, revision };
}

function hashRecord({
  record,
  assets,
}: {
  record: Extract<SyncRecord, { operation: 'upsert' }>;
  assets: DeliveryAsset[];
}) {
  return canonicalJson({
    id: record.id,
    kind: record.kind,
    data: record.data,
    content: record.content ?? null,
    assetRefs: record.assetRefs ?? {},
    assets,
    preview: record.preview ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  }).sha256;
}
