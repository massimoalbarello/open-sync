import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Deliverable, DeliveredRecord } from '@context-use/open-sync/delivery';
import { canonicalJson } from '@context-use/open-sync/json';
import type { RecordContent } from '@context-use/open-sync/record';
import type { SQL, TransactionSQL } from 'bun';
import { acceptAsset, recoverAssetFiles } from './assets';
import { browseAssets, findAsset, relateAssets } from './browse-assets';
import type { ReceiverRepository, ReceiverScope, RecordIdentity } from './contract';

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
  assetInfo(input: ReceiverScope & { id: string }) {
    return findAsset({ ...input, db: this.db });
  }
  async record(input: ReceiverScope & RecordIdentity) {
    const [row] = await this.db<
      RecordRow[]
    >`SELECT sync_id,kind,record_id,revision,data,content,asset_ids,preview,created_at,updated_at FROM host_records
      WHERE owner_id=${input.ownerId} AND sync_id=${input.syncId} AND kind=${input.kind}
      AND record_id=${input.id} AND deleted=0`;
    if (!row) {
      return;
    }
    return (await relateAssets({ ...input, db: this.db, records: [recordRow(row)] }))[0];
  }
  async asset(input: ReceiverScope & { id: string }) {
    const [row] = await this.db<
      { file_id: string; name: string; media_type: string }[]
    >`SELECT file_id,name,media_type FROM host_assets WHERE owner_id=${input.ownerId} AND id=${input.id}`;
    if (!row) {
      return;
    }
    const path = join(this.assetDirectory, row.file_id);
    const file = Bun.file(path);
    return {
      name: row.name,
      mediaType: row.media_type,
      size: file.size,
      open: (range?: { start: number; end: number }) =>
        range
          ? // Node and DOM types declare incompatible overloads for the same web stream.
            (Readable.toWeb(
              createReadStream(path, { start: range.start, end: range.end - 1 }),
            ) as unknown as ReadableStream<Uint8Array>)
          : file.stream(),
    };
  }
  async records(input: ReceiverScope & { syncId?: string; offset: number }) {
    const limit = 50;
    const syncId = input.syncId ?? null;
    const rows = await this.db<
      RecordRow[]
    >`SELECT sync_id,kind,record_id,revision,data,content,asset_ids,preview,created_at,updated_at FROM host_records
      WHERE owner_id=${input.ownerId} AND deleted=0 AND (${syncId} IS NULL OR sync_id=${syncId})
      ORDER BY updated_at DESC,sync_id,kind,record_id LIMIT ${limit + 1} OFFSET ${input.offset}`;
    return {
      records: await relateAssets({
        ...input,
        db: this.db,
        records: rows.slice(0, limit).map(recordRow),
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
  async accept(
    input: ReceiverScope & { delivery: Omit<Deliverable, 'openAsset'> },
  ): Promise<boolean> {
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
          throw new Error('Deliverable identity reused with different content');
        }
        return true;
      }
      for (const record of input.delivery.records) {
        await applyRecord({
          tx,
          ownerId: input.ownerId,
          syncId: input.delivery.syncId,
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
  syncId: string;
  record: DeliveredRecord;
}): Promise<void> {
  const { tx, ownerId, syncId, record } = input;
  const data = record.operation === 'upsert' ? canonicalJson(record.data).json : null;
  const metadata = record.operation === 'upsert' ? record : undefined;
  const content =
    record.operation === 'upsert' && record.content ? canonicalJson(record.content).json : null;
  const references = record.operation === 'upsert' ? Object.values(record.assetRefs ?? {}) : [];
  const assets = references.length
    ? await tx<
        { id: string }[]
      >`SELECT DISTINCT a.id FROM json_each(${JSON.stringify(references)}) ref
        JOIN host_assets a ON a.owner_id=${ownerId} AND a.sync_id=${syncId}
        AND a.asset_id=json_extract(ref.value,'$.id') AND a.asset_version=json_extract(ref.value,'$.version')
        ORDER BY cast(ref.key AS INTEGER)`
    : [];
  const assetIds = JSON.stringify(assets.map((asset) => asset.id));
  await tx`INSERT INTO host_records(owner_id,sync_id,kind,record_id,revision,deleted,data,asset_ids,content,preview,created_at,updated_at)
    VALUES (${ownerId},${syncId},${record.kind},${record.id},${record.revision},${Number(record.operation === 'delete')},${data},${assetIds},${content},${metadata?.preview ?? null},${metadata?.createdAt ?? null},${metadata?.updatedAt ?? null})
    ON CONFLICT(owner_id,sync_id,kind,record_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,data=excluded.data,asset_ids=excluded.asset_ids,content=excluded.content,preview=excluded.preview,created_at=excluded.created_at,updated_at=excluded.updated_at
    WHERE excluded.revision>host_records.revision`;
}

async function isPaused(input: { db: SQL | TransactionSQL; scope: ReceiverScope }) {
  const [settings] =
    await input.db`SELECT paused FROM host_settings WHERE owner_id=${input.scope.ownerId}`;
  return Boolean(settings?.paused);
}

interface RecordRow {
  sync_id: string;
  kind: string;
  record_id: string;
  revision: number;
  data: string;
  content: string | null;
  asset_ids: string;
  preview: string | null;
  created_at: string | null;
  updated_at: string | null;
}
function recordRow(row: RecordRow) {
  return {
    syncId: row.sync_id,
    kind: row.kind,
    id: row.record_id,
    revision: row.revision,
    ...(row.preview !== null ? { preview: row.preview } : {}),
    ...(row.created_at !== null ? { createdAt: row.created_at } : {}),
    ...(row.updated_at !== null ? { updatedAt: row.updated_at } : {}),
    assetIds: JSON.parse(row.asset_ids) as string[],
    data: JSON.parse(row.data) as import('@context-use/open-sync/json').JsonObject,
    ...(row.content === null ? {} : { content: JSON.parse(row.content) as RecordContent }),
  };
}
