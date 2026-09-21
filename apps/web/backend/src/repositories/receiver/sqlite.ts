import { join } from 'node:path';
import type { DeliveredRecord, Delivery } from '@context-use/open-sync/delivery';
import { canonicalJson } from '@context-use/open-sync/json';
import type { SQL, TransactionSQL } from 'bun';
import { acceptAsset, recoverAssetFiles } from './assets';
import { browseAssets, relateAssets } from './browse-assets';
import type { ReceiverRepository, ReceiverScope } from './contract';

export class SqliteReceiver implements ReceiverRepository {
  private readonly db: SQL;
  private readonly assetDirectory: string;
  private constructor(input: { db: SQL; assetDirectory: string }) {
    this.db = input.db;
    this.assetDirectory = input.assetDirectory;
  }
  /** Open before starting uploads; this receiver exclusively owns its asset directory. */
  static async open(input: { db: SQL; assetDirectory: string }) {
    await recoverAssetFiles({ db: input.db, directory: input.assetDirectory });
    return new SqliteReceiver(input);
  }
  acceptAsset(input: Parameters<ReceiverRepository['acceptAsset']>[0]) {
    return acceptAsset({ ...input, db: this.db, directory: this.assetDirectory });
  }
  assets(input: Parameters<ReceiverRepository['assets']>[0]) {
    return browseAssets({ ...input, db: this.db });
  }
  async asset(input: ReceiverScope & { id: string }) {
    const [row] = await this.db<
      { file_id: string; name: string; media_type: string }[]
    >`SELECT file_id,name,media_type FROM host_assets WHERE owner_id=${input.ownerId} AND id=${input.id}`;
    if (!row) {
      return;
    }
    return {
      name: row.name,
      mediaType: row.media_type,
      body: Bun.file(join(this.assetDirectory, row.file_id)).stream(),
    };
  }
  async records(input: ReceiverScope & { sourceId?: string; offset: number }) {
    const limit = 50;
    const sourceId = input.sourceId ?? null;
    const rows = await this.db<
      {
        source_id: string;
        kind: string;
        record_id: string;
        revision: number;
        data: string;
        asset_ids: string;
      }[]
    >`SELECT source_id,kind,record_id,revision,data,asset_ids FROM host_records
      WHERE owner_id=${input.ownerId} AND deleted=0 AND (${sourceId} IS NULL OR source_id=${sourceId})
      ORDER BY source_id,kind,record_id LIMIT ${limit + 1} OFFSET ${input.offset}`;
    return {
      records: await relateAssets({
        ...input,
        db: this.db,
        records: rows.slice(0, limit).map((row) => ({
          sourceId: String(row.source_id),
          kind: String(row.kind),
          id: String(row.record_id),
          revision: Number(row.revision),
          assetIds: JSON.parse(row.asset_ids) as string[],
          data: JSON.parse(String(row.data)) as import('@context-use/open-sync/json').JsonObject,
        })),
      }),
      hasMore: rows.length > limit,
      pageSize: limit,
    };
  }
  isPaused(scope: ReceiverScope) {
    return isPaused({ db: this.db, scope });
  }
  async status(scope: ReceiverScope) {
    const [status] = await this.db`SELECT
      coalesce((SELECT paused FROM host_settings WHERE owner_id=${scope.ownerId}),0) AS paused,
      (SELECT count(*) FROM host_records WHERE owner_id=${scope.ownerId} AND deleted=0) AS records,
      (SELECT count(*) FROM host_receipts WHERE owner_id=${scope.ownerId}) AS receipts`;
    return {
      paused: Boolean(status.paused),
      records: Number(status.records),
      receipts: Number(status.receipts),
    };
  }
  async setPaused(input: ReceiverScope & { paused: boolean }): Promise<void> {
    await this
      .db`INSERT INTO host_settings(owner_id,paused) VALUES (${input.ownerId},${Number(input.paused)})
      ON CONFLICT(owner_id) DO UPDATE SET paused=excluded.paused`;
  }
  async accept(input: ReceiverScope & { delivery: Delivery }): Promise<boolean> {
    if (input.ownerId !== input.delivery.ownerId) {
      throw new Error('Receiver owner mismatch');
    }
    const bodyHash = canonicalJson(input.delivery).sha256;
    return await this.db.begin(async (tx) => {
      if (await isPaused({ db: tx, scope: input })) {
        return false;
      }
      const [receipt] =
        await tx`SELECT body_hash FROM host_receipts WHERE owner_id=${input.ownerId} AND delivery_id=${input.delivery.id}`;
      if (receipt) {
        if (receipt.body_hash !== bodyHash) {
          throw new Error('Delivery identity reused with different content');
        }
        return true;
      }
      for (const record of input.delivery.deliverable.records) {
        await applyRecord({
          tx,
          ownerId: input.ownerId,
          sourceId: input.delivery.sourceId,
          record,
        });
      }
      await tx`INSERT INTO host_receipts VALUES (${input.ownerId},${input.delivery.id},${bodyHash})`;
      return true;
    });
  }
}
async function applyRecord(input: {
  tx: TransactionSQL;
  ownerId: string;
  sourceId: string;
  record: DeliveredRecord;
}): Promise<void> {
  const { tx, ownerId, sourceId, record } = input;
  const data = record.operation === 'upsert' ? canonicalJson(record.data).json : null;
  const references = record.operation === 'upsert' ? Object.values(record.assetRefs ?? {}) : [];
  const assets = references.length
    ? await tx<
        { id: string }[]
      >`SELECT DISTINCT a.id FROM json_each(${JSON.stringify(references)}) ref
        JOIN host_assets a ON a.owner_id=${ownerId} AND a.source_id=${sourceId}
        AND a.asset_id=json_extract(ref.value,'$.id') AND a.asset_version=json_extract(ref.value,'$.version')
        ORDER BY cast(ref.key AS INTEGER)`
    : [];
  const assetIds = JSON.stringify(assets.map((asset) => asset.id));
  await tx`INSERT INTO host_records(owner_id,source_id,kind,record_id,revision,deleted,data,asset_ids)
    VALUES (${ownerId},${sourceId},${record.kind},${record.id},${record.revision},${Number(record.operation === 'delete')},${data},${assetIds})
    ON CONFLICT(owner_id,source_id,kind,record_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,data=excluded.data,asset_ids=excluded.asset_ids
    WHERE excluded.revision>host_records.revision`;
}

async function isPaused(input: { db: SQL | TransactionSQL; scope: ReceiverScope }) {
  const [settings] =
    await input.db`SELECT paused FROM host_settings WHERE owner_id=${input.scope.ownerId}`;
  return Boolean(settings?.paused);
}
