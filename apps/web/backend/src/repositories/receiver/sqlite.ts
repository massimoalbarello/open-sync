import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { canonicalJson } from '@context-use/open-sync/json';
import type { SQL } from 'bun';
import { copyAsset, recoverAssetFiles } from './assets';
import type { ReceivedDeliverable, ReceiverRepository } from './contract';

export class SqliteReceiver implements ReceiverRepository {
  private readonly db: SQL;
  private readonly assetDirectory: string;
  private constructor(input: { db: SQL; assetDirectory: string }) {
    this.db = input.db;
    this.assetDirectory = input.assetDirectory;
  }
  /** Open before deliveries start; this receiver exclusively owns its asset directory. */
  static async open(input: { db: SQL; assetDirectory: string }) {
    await recoverAssetFiles({ db: input.db, directory: input.assetDirectory });
    return new SqliteReceiver(input);
  }
  async deliverables(input: Parameters<ReceiverRepository['deliverables']>[0]) {
    const limit = 20;
    const before = input.before ?? Number.MAX_SAFE_INTEGER;
    const rows = await this.db<
      {
        sequence: number;
        id: string;
        sync_id: string;
        received_at: number;
        record_count: number;
        asset_count: number;
      }[]
    >`SELECT sequence,id,sync_id,received_at,
      json_array_length(body,'$.records') AS record_count,
      json_array_length(body,'$.assets') AS asset_count FROM host_deliverables
      WHERE owner_id=${input.scope.ownerId} AND sync_id=${input.syncId} AND sequence<${before}
      ORDER BY sequence DESC LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    return {
      deliverables: page.map((row) => ({
        id: row.id,
        syncId: row.sync_id,
        receivedAt: row.received_at,
        recordCount: row.record_count,
        assetCount: row.asset_count,
      })),
      nextCursor: rows.length > limit ? page.at(-1)!.sequence : null,
    };
  }
  async deliverable(input: Parameters<ReceiverRepository['deliverable']>[0]) {
    const [row] = await this.db<{ body: string; received_at: number }[]>`
      SELECT body,received_at FROM host_deliverables
      WHERE owner_id=${input.scope.ownerId} AND sync_id=${input.syncId} AND id=${input.id}`;
    return row
      ? {
          deliverable: JSON.parse(row.body) as ReceivedDeliverable['deliverable'],
          receivedAt: row.received_at,
        }
      : undefined;
  }
  async asset(input: Parameters<ReceiverRepository['asset']>[0]) {
    const [row] = await this.db<{ body: string; files: string }[]>`
      SELECT body,files FROM host_deliverables
      WHERE owner_id=${input.scope.ownerId} AND sync_id=${input.syncId} AND id=${input.id}`;
    if (!row) {
      return;
    }
    const body = JSON.parse(row.body) as ReceivedDeliverable['deliverable'];
    const asset = body.assets[input.index];
    const fileId = (JSON.parse(row.files) as (string | null)[])[input.index];
    if (!asset || 'unavailable' in asset || !fileId) {
      return;
    }
    const path = join(this.assetDirectory, fileId);
    return {
      name: asset.name,
      mediaType: asset.mediaType,
      size: asset.size,
      open: (range?: { start: number; end: number }) =>
        range
          ? // Node and DOM types declare incompatible overloads for the same web stream.
            (Readable.toWeb(
              createReadStream(path, { start: range.start, end: range.end - 1 }),
            ) as unknown as ReadableStream<Uint8Array>)
          : Bun.file(path).stream(),
    };
  }
  async accept(input: Parameters<ReceiverRepository['accept']>[0]): Promise<void> {
    input.signal.throwIfAborted();
    const { openAsset, ...body } = input.deliverable;
    if (input.scope.ownerId !== body.ownerId) {
      throw new Error('Receiver owner mismatch');
    }
    const canonical = canonicalJson(body);
    const [existing] = await this.db<{ body_hash: string }[]>`
      SELECT body_hash FROM host_deliverables WHERE owner_id=${input.scope.ownerId} AND id=${body.id}`;
    if (existing) {
      if (existing.body_hash !== canonical.sha256) {
        throw new Error('Deliverable identity reused with different content');
      }
      return;
    }
    const files: (string | null)[] = [];
    let committed = false;
    try {
      for (const asset of body.assets) {
        input.signal.throwIfAborted();
        files.push(
          'unavailable' in asset
            ? null
            : await copyAsset({
                asset,
                directory: this.assetDirectory,
                signal: input.signal,
                open: () => openAsset(asset),
              }),
        );
      }
      input.signal.throwIfAborted();
      committed = await this.db.begin(async (tx) => {
        const inserted =
          await tx`INSERT INTO host_deliverables(owner_id,sync_id,id,body,body_hash,files,received_at)
          VALUES (${input.scope.ownerId},${body.syncId},${body.id},${canonical.json},${canonical.sha256},${JSON.stringify(files)},${Date.now()})
          ON CONFLICT(owner_id,id) DO NOTHING RETURNING sequence`;
        const [saved] = await tx<{ body_hash: string }[]>`
          SELECT body_hash FROM host_deliverables WHERE owner_id=${input.scope.ownerId} AND id=${body.id}`;
        if (saved?.body_hash !== canonical.sha256) {
          throw new Error('Deliverable identity reused with different content');
        }
        return inserted.length > 0;
      });
    } finally {
      if (!committed) {
        await Promise.all(
          files.map((file) => (file ? unlink(join(this.assetDirectory, file)) : undefined)),
        );
      }
    }
  }
}
