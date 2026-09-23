import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetRef } from '@context-use/open-sync/assets';
import type { JsonObject } from '@context-use/open-sync/json';
import type { RecordContent } from '@context-use/open-sync/record';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';

const owner = { actorId: 'alice', ownerId: 'alice' };
const other = { actorId: 'bob', ownerId: 'bob' };

async function withReceiver(run: (input: { receiver: SqliteReceiver; db: SQL }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'browse-assets-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  try {
    await runMigrations({ db });
    await run({
      receiver: await SqliteReceiver.open({ db, assetDirectory: join(dir, 'assets') }),
      db,
    });
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function receiveAsset(input: {
  receiver: SqliteReceiver;
  id: string;
  scope?: typeof owner;
  sourceId?: string;
  updatedAt?: string;
  createdAt?: string;
}) {
  const bytes = new TextEncoder().encode(input.id);
  return input.receiver.acceptAsset({
    ...(input.scope ?? owner),
    sourceId: input.sourceId ?? 'source',
    idempotencyKey: input.id,
    signal: new AbortController().signal,
    asset: {
      id: input.id,
      version: '1',
      name: 'same-name.txt',
      mediaType: 'text/plain',
      size: bytes.length,
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    },
    open: () => Promise.resolve(new Blob([bytes]).stream()),
  });
}

function receiveRecord(input: {
  receiver: SqliteReceiver;
  data: JsonObject;
  revision: number;
  content?: RecordContent;
  assetRefs?: Record<string, AssetRef>;
  deliveryId?: string;
}) {
  return input.receiver.accept({
    ...owner,
    delivery: {
      version: 1,
      id: input.deliveryId ?? `delivery_${input.revision}`,
      ownerId: owner.ownerId,
      sourceId: 'source',
      installationId: 'sync',
      definition: { id: 'test', version: '1', artifactId: 'test/1' },
      deliverable: {
        records: [
          {
            operation: 'upsert',
            kind: 'document',
            id: 'record',
            data: input.data,
            ...(input.content ? { content: input.content } : {}),
            ...(input.assetRefs ? { assetRefs: input.assetRefs } : {}),
            revision: input.revision,
            contentHash: `hash_${input.revision}`,
            eventId: `event_${input.revision}`,
          },
        ],
      },
    },
  });
}

test('assets browse in bounded pages with owner and source isolation and public metadata only', async () => {
  await withReceiver(async ({ receiver }) => {
    const count = 51;
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const id = await receiveAsset({
        receiver,
        id: String(index),
        updatedAt: index < 2 ? undefined : new Date(index).toISOString(),
        createdAt: index < 2 ? '2026-01-01T00:00:00.000Z' : undefined,
      });
      ids.push(id);
    }
    const foreign = await receiveAsset({ receiver, id: 'foreign', scope: other });
    const anotherSource = await receiveAsset({ receiver, id: 'another', sourceId: 'other-source' });
    const first = await receiver.assets({ ...owner, sourceId: 'source', offset: 0 });
    expect(first.assets).toHaveLength(first.pageSize);
    expect(first.hasMore).toBe(true);
    const last = await receiver.assets({ ...owner, sourceId: 'source', offset: first.pageSize });
    expect(last.assets).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    const all = [...first.assets, ...last.assets];
    const unknown = ids.slice(0, 2).sort();
    expect(all.map((asset) => asset.id)).toEqual([...ids.slice(2).reverse(), ...unknown]);
    expect(new Set(all.map((asset) => asset.id)).size).toBe(count);
    expect(all.map((asset) => asset.id)).not.toContain(foreign);
    expect(all.map((asset) => asset.id)).not.toContain(anotherSource);
    expect(Object.keys(all[0]!).sort()).toEqual([
      'id',
      'mediaType',
      'name',
      'size',
      'sourceId',
      'updatedAt',
    ]);
    expect(
      (await receiver.assets({ ...owner, sourceId: 'other-source', offset: 0 })).assets.map(
        (asset) => asset.id,
      ),
    ).toEqual([anotherSource]);
    expect(
      (await receiver.assets({ ...other, offset: 0 })).assets.map((asset) => asset.id),
    ).toEqual([foreign]);
    expect((await receiver.assets({ ...owner, offset: 0 })).assets).toHaveLength(first.pageSize);
  });
});

test('records persist declared asset relationships independently of rendered content and revision order', async () => {
  await withReceiver(async ({ receiver, db }) => {
    const first = await receiveAsset({ receiver, id: 'first' });
    const second = await receiveAsset({ receiver, id: 'second' });
    const unlinked = await receiveAsset({ receiver, id: 'unlinked' });
    await receiveAsset({ receiver, id: 'foreign', scope: other });
    await receiveAsset({ receiver, id: 'another', sourceId: 'other-source' });
    const assetRefs = Object.fromEntries(
      ['first', 'second', 'foreign', 'another', 'missing'].map((id) => [id, { id, version: '1' }]),
    );
    assetRefs.repeated = { id: 'first', version: '1' };
    const data = { body: unlinked, attachment: `[copied link](/api/receiver/assets/${unlinked})` };
    await receiveRecord({
      receiver,
      data,
      assetRefs,
      revision: 1,
      content: { format: 'markdown', body: '# Original' },
    });
    const record = (await receiver.records({ ...owner, offset: 0 })).records[0]!;
    expect(record.data).toEqual(data);
    expect(record.content?.body).toBe('# Original');
    expect(record.assets.map((asset) => asset.id)).toEqual([first, second]);
    expect(record).not.toHaveProperty('assetIds');
    expect((await receiver.records({ ...other, offset: 0 })).records).toEqual([]);
    await db.unsafe(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON host_receipts BEGIN SELECT RAISE(ABORT,'injected'); END",
    );
    await expect(
      receiveRecord({ receiver, data: { body: 'replacement' }, revision: 2 }),
    ).rejects.toThrow('injected');
    expect((await receiver.records({ ...owner, offset: 0 })).records[0]).toMatchObject({
      revision: 1,
      data,
      assets: [{ id: first }, { id: second }],
    });
    await db.unsafe('DROP TRIGGER fail_receipt');
    await receiveRecord({
      receiver,
      data,
      assetRefs: { file: { id: 'second', version: '1' } },
      revision: 2,
    });
    await receiveRecord({ receiver, data, assetRefs, revision: 1, deliveryId: 'stale' });
    expect(
      (await receiver.records({ ...owner, offset: 0 })).records[0]!.assets.map((asset) => asset.id),
    ).toEqual([second]);
    // Matching content alone cannot create an attachment relationship.
    await receiveRecord({
      receiver,
      data: { body: first, link: `/api/receiver/assets/${second}` },
      revision: 3,
    });
    expect((await receiver.records({ ...owner, offset: 0 })).records[0]!.assets).toEqual([]);
    expect((await receiver.records({ ...owner, offset: 0 })).records[0]!).not.toHaveProperty(
      'content',
    );
  });
});
