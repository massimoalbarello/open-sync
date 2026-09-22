import type { Database } from 'bun:sqlite';
import type { AssetRef, DeliveryAsset } from '../../models/asset';
import { assetKey } from '../../models/asset';
import type { DeliveredRecord, Delivery } from '../../models/delivery';
import { fail } from '../../models/error';
import type { Installation } from '../../models/installation';
import { canonicalJson } from '../../models/json';
import type { QueueLimits } from '../../models/limits';
import { queueUsage } from '../queue-usage';

export function enqueue(input: {
  db: Database;
  installation: Installation;
  records: DeliveredRecord[];
  limits: QueueLimits;
  assets?: readonly AssetRef[];
}): void {
  if (!input.records.length && !input.assets?.length) {
    return;
  }
  const { installation, db, limits } = input;
  const assets = pageAssets(input);
  const delivery: Delivery = {
    version: assets.length ? 2 : 1,
    id: `delivery_${crypto.randomUUID()}`,
    ownerId: installation.ownerId,
    sourceId: installation.sourceId,
    installationId: installation.id,
    definition: installation.definition,
    deliverable: { records: input.records, ...(assets.length ? { assets } : {}) },
  };
  const body = canonicalJson(delivery).json;
  const bytes = Buffer.byteLength(body);
  if (
    bytes > Math.min(limits.maxPendingBytes, limits.maxSyncPendingBytes) ||
    input.records.length > Math.min(limits.maxPendingRecords, limits.maxSyncPendingRecords)
  ) {
    fail('page_exceeds_queue_capacity');
  }
  const usage = queueUsage({ db });
  const own = queueUsage({ db, ownerId: installation.ownerId, installationId: installation.id });
  if (
    bytes + own.pendingBytes > limits.maxSyncPendingBytes ||
    input.records.length + own.pendingRecords > limits.maxSyncPendingRecords ||
    bytes + usage.pendingBytes > limits.maxPendingBytes ||
    input.records.length + usage.pendingRecords > limits.maxPendingRecords
  ) {
    fail('waiting_for_capacity');
  }
  db.query(
    'INSERT INTO deliveries(owner_id,id,installation_id,destination_id,body,bytes,record_count,due_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    installation.ownerId,
    delivery.id,
    installation.id,
    installation.destinationId,
    body,
    bytes,
    input.records.length,
    Date.now(),
  );
  for (const asset of assets) {
    db.query(
      'UPDATE assets SET committed=1 WHERE owner_id=? AND source_id=? AND id=? AND version=?',
    ).run(installation.ownerId, installation.sourceId, asset.id, asset.version);
    db.query('INSERT INTO delivery_assets VALUES (?,?,?,?,?)').run(
      installation.ownerId,
      delivery.id,
      installation.sourceId,
      asset.id,
      asset.version,
    );
  }
}

function pageAssets(input: {
  db: Database;
  installation: Installation;
  records: DeliveredRecord[];
  assets?: readonly AssetRef[];
}): DeliveryAsset[] {
  const { db, installation } = input;
  const refs = new Map((input.assets ?? []).map((asset) => [assetKey(asset), asset]));
  for (const record of input.records) {
    if (record.operation === 'upsert') {
      for (const asset of Object.values(record.assetRefs ?? {})) {
        refs.set(assetKey(asset), asset);
      }
    }
  }
  const assets: DeliveryAsset[] = [...refs.values()].map((asset) => {
    const row = db
      .query<
        { metadata: string; state: string; sha256: string; size: number; error_code: string },
        string[]
      >('SELECT * FROM assets WHERE owner_id=? AND source_id=? AND id=? AND version=?')
      .get(installation.ownerId, installation.sourceId, asset.id, asset.version);
    if (!row || row.state === 'pending') {
      return fail('asset_not_captured');
    }
    return {
      ...JSON.parse(row.metadata),
      ...(row.state === 'ready'
        ? { size: row.size, sha256: row.sha256 }
        : { unavailable: row.error_code }),
    };
  });

  return assets;
}
