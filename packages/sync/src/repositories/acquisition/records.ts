import type { Database } from 'bun:sqlite';
import type { DeliveredRecord, SyncRecord } from '../../models/delivery';
import type { Installation } from '../../models/installation';
import { canonicalJson } from '../../models/json';

export function writeRecord(input: {
  db: Database;
  installation: Installation;
  record: SyncRecord;
}): DeliveredRecord | undefined {
  const { db, installation, record } = input;
  const previous = db
    .query<{ hash: string; revision: number; deleted: number }, [string, string, string, string]>(
      'SELECT hash,revision,deleted FROM records WHERE owner_id=? AND installation_id=? AND kind=? AND id=?',
    )
    .get(installation.ownerId, installation.id, record.kind, record.id);
  if (record.operation === 'delete' && (!previous || previous.deleted === 1)) {
    return;
  }
  const contentHash = record.operation === 'upsert' ? hashRecord(record) : previous!.hash;
  if (record.operation === 'upsert' && previous?.deleted === 0 && previous.hash === contentHash) {
    return;
  }
  const revision = (previous?.revision ?? 0) + 1;
  db.query(`INSERT INTO records VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,installation_id,kind,id)
    DO UPDATE SET hash=excluded.hash,revision=excluded.revision,deleted=excluded.deleted`).run(
    installation.ownerId,
    installation.id,
    record.kind,
    record.id,
    contentHash,
    revision,
    Number(record.operation === 'delete'),
  );
  return { ...record, eventId: `event_${crypto.randomUUID()}`, revision, contentHash };
}

function hashRecord(record: Extract<SyncRecord, { operation: 'upsert' }>) {
  // A tuple cannot collide with a legacy record's arbitrary JSON object.
  if (record.content) {
    return canonicalJson([
      record.data,
      record.content,
      record.assetRefs ?? {},
      record.markdownFields ?? [],
    ]).sha256;
  }
  return canonicalJson(
    record.assetRefs || record.markdownFields
      ? {
          data: record.data,
          assetRefs: record.assetRefs ?? {},
          markdownFields: record.markdownFields ?? [],
        }
      : record.data,
  ).sha256;
}
