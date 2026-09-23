import { createHash } from 'node:crypto';
import { mkdir, open, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeliveryAsset } from '@context-use/open-sync/assets';
import type { SQL } from 'bun';

/** Runs before deliveries start. Only generated files absent from accepted deliverables are removed. */
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
    const [stored] =
      await input.db`SELECT 1 FROM host_deliverables,json_each(host_deliverables.files) file
      WHERE file.value=${file.name} LIMIT 1`;
    if (!stored) {
      await unlink(join(input.directory, file.name));
    }
  }
}

const privateFileMode = 0o600;

export async function copyAsset(input: {
  asset: Extract<DeliveryAsset, { size: number }>;
  directory: string;
  signal: AbortSignal;
  open(): Promise<ReadableStream<Uint8Array>>;
}) {
  const fileId = crypto.randomUUID();
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  const path = join(input.directory, fileId);
  const file = await open(path, 'wx', privateFileMode);
  let complete = false;
  try {
    const digest = createHash('sha256');
    let size = 0;
    const body = (await input.open()).pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
      signal: input.signal,
    });
    for await (const chunk of body) {
      input.signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > input.asset.size) {
        throw new Error('Asset size mismatch');
      }
      digest.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        offset += (await file.write(chunk.subarray(offset))).bytesWritten;
      }
    }
    if (size !== input.asset.size || digest.digest('hex') !== input.asset.sha256) {
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
    complete = true;
    return fileId;
  } finally {
    await file.close();
    if (!complete) {
      await unlink(path);
    }
  }
}
