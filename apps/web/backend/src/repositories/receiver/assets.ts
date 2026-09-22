const privateFileMode = 0o600;

import { createHash } from 'node:crypto';
import { mkdir, open, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '@context-use/open-sync/json';
import type { SQL } from 'bun';
import type { ReceiverRepository } from './contract';

/** Runs before uploads start. Only generated files absent from durable receipts are removed. */
export async function recoverAssetFiles(input: { db: SQL; directory: string }) {
  const directory = await opendir(input.directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  if (!directory) {
    return;
  }
  for await (const file of directory) {
    if (!file.isFile() || !/^[0-9a-f-]{36}$/.test(file.name)) {
      continue;
    }
    const [stored] = await input.db`SELECT 1 FROM host_assets WHERE file_id=${file.name} LIMIT 1`;
    if (!stored) {
      await unlink(join(input.directory, file.name));
    }
  }
}

export async function acceptAsset(
  input: Parameters<ReceiverRepository['acceptAsset']>[0] & { db: SQL; directory: string },
) {
  const { db, asset } = input;
  if ('unavailable' in asset) {
    throw new Error('Asset has no content');
  }
  const hash = canonicalJson(asset).sha256;
  const existing = await findAsset(input);
  if (existing) {
    if (existing.metadata_hash !== hash) {
      throw new Error('Asset identity reused with different content');
    }
    return existing.id;
  }
  const fileId = crypto.randomUUID();
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  const path = join(input.directory, fileId);
  const file = await open(path, 'wx', privateFileMode);
  let keep = false;
  try {
    const digest = createHash('sha256');
    let size = 0;
    const body = (await input.open()).pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
      signal: input.signal,
    });
    for await (const chunk of body) {
      input.signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > asset.size) {
        throw new Error('Asset size mismatch');
      }
      digest.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        offset += (await file.write(chunk.subarray(offset))).bytesWritten;
      }
    }
    if (size !== asset.size || digest.digest('hex') !== asset.sha256) {
      throw new Error('Asset content mismatch');
    }
    await file.sync();
    const folder = await open(input.directory, 'r');
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
    input.signal.throwIfAborted();
    const id = `asset_${crypto.randomUUID()}`;
    const result = await db.begin(async (tx) => {
      await tx`INSERT INTO host_assets(owner_id,id,source_id,asset_id,asset_version,idempotency_key,metadata_hash,file_id,name,media_type,size,created_at,updated_at)
        VALUES (${input.ownerId},${id},${input.sourceId},${asset.id},${asset.version},${input.idempotencyKey},${hash},${fileId},${asset.name},${asset.mediaType},${asset.size},${asset.createdAt ?? null},${asset.updatedAt ?? null}) ON CONFLICT DO NOTHING`;
      const [row] = await tx<
        { id: string; file_id: string; metadata_hash: string }[]
      >`SELECT id,file_id,metadata_hash FROM host_assets WHERE owner_id=${input.ownerId} AND source_id=${input.sourceId} AND asset_id=${asset.id} AND asset_version=${asset.version}`;
      if (!row || row.metadata_hash !== hash) {
        throw new Error('Asset identity conflict');
      }
      return row;
    });
    keep = result.file_id === fileId;
    return result.id;
  } finally {
    await file.close();
    if (!keep) {
      await unlink(path);
    }
  }
}
async function findAsset(input: Parameters<ReceiverRepository['acceptAsset']>[0] & { db: SQL }) {
  const [row] = await input.db<
    { id: string; metadata_hash: string }[]
  >`SELECT id,metadata_hash FROM host_assets WHERE owner_id=${input.ownerId} AND (idempotency_key=${input.idempotencyKey} OR (source_id=${input.sourceId} AND asset_id=${input.asset.id} AND asset_version=${input.asset.version}))`;
  return row;
}
