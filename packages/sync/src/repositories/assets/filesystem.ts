const privateFileMode = 0o600;

import { createHash } from 'node:crypto';
import { mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '../../models/error';
import type { AssetFiles } from './contract';

/** A directory dedicated to this queue. Names come only from generated UUIDs, never provider filenames. */
export class DirectoryAssets implements AssetFiles {
  constructor(private readonly directory: string) {}
  async write(input: Parameters<AssetFiles['write']>[0]) {
    const reader = input.body.getReader();
    const id = crypto.randomUUID();
    let file: Awaited<ReturnType<typeof open>> | undefined;
    const hash = createHash('sha256');
    let size = 0;
    const abort = () => {
      void reader.cancel().catch(() => undefined);
    };
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      input.signal.throwIfAborted();
      input.reserve({ id, bytes: 0 });
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      file = await open(this.path(id), 'wx', privateFileMode);
      while (true) {
        input.signal.throwIfAborted();
        const chunk = await reader.read();
        input.signal.throwIfAborted();
        if (chunk.done) {
          break;
        }
        size += chunk.value.byteLength;
        if (size > input.maxBytes) {
          fail('asset_too_large');
        }
        input.reserve({ id, bytes: size });
        hash.update(chunk.value);
        let offset = 0;
        while (offset < chunk.value.byteLength) {
          const written = await file.write(chunk.value.subarray(offset));
          offset += written.bytesWritten;
        }
      }
      await file.sync();
      await file.close();
      file = undefined;
      const directory = await open(this.directory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return { id, size, sha256: hash.digest('hex') };
    } catch (error) {
      try {
        await file?.close();
      } finally {
        await this.remove(id);
      }
      throw error;
    } finally {
      input.signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  async open(id: string) {
    const file = Bun.file(this.path(id));
    if (!(await file.exists())) {
      fail('asset_content_missing');
    }
    return file.stream();
  }
  async remove(id: string) {
    await unlink(this.path(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
  async sweep(input: Parameters<AssetFiles['sweep']>[0]) {
    const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return [] as string[];
    });
    for (const name of names) {
      if (!/^[0-9a-f-]{36}$/.test(name) || input.retain(name)) {
        continue;
      }
      await this.remove(name);
    }
  }
  private path(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      fail('invalid_asset_file');
    }
    return join(this.directory, id);
  }
}
