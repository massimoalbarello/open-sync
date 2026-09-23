import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Deliverable } from '@context-use/open-sync/delivery';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';

export const scope = { actorId: 'alice', ownerId: 'alice' };
export const signal = new AbortController().signal;
export function bundle(id = 'delivery'): Deliverable {
  return {
    id,
    ownerId: scope.ownerId,
    syncId: 'sync',
    definition: 'source',
    records: [
      {
        operation: 'upsert',
        kind: 'note',
        id: 'note',
        revision: 1,
        data: { file: 'open-sync-asset:file', nested: [true, { arbitrary: 'schema' }] },
        content: { format: 'markdown', body: '[File](open-sync-asset:file)' },
        preview: 'A note',
        createdAt: '2026-01-01T00:00:00.000Z',
        assetRefs: { file: { id: 'file', version: '1' } },
      },
    ],
    assets: [
      {
        id: 'file',
        version: '1',
        name: '../file.txt',
        mediaType: 'text/plain',
        size: 4,
        sha256: new Bun.CryptoHasher('sha256').update('file').digest('hex'),
      },
      {
        id: 'unavailable',
        version: '1',
        name: 'missing.txt',
        mediaType: 'text/plain',
        unavailable: 'source_restriction',
      },
    ],
    openAsset: (asset) => Promise.resolve(new Blob([asset.id]).stream()),
  };
}
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'receiver-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(directory, 'host.db') });
  const assetDirectory = join(directory, 'assets');
  await runMigrations({ db });
  return {
    directory,
    db,
    assetDirectory,
    receiver: await SqliteReceiver.open({ db, assetDirectory }),
    async close() {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
