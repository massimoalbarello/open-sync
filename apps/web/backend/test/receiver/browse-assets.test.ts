import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonObject } from '@context-use/open-sync/json';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';

const owner = { actorId: 'alice', ownerId: 'alice' };
const other = { actorId: 'bob', ownerId: 'bob' };

async function withReceiver(run: (receiver: SqliteReceiver) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'browse-assets-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  try {
    await runMigrations({ db });
    await run(new SqliteReceiver({ db, assetDirectory: join(dir, 'assets') }));
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
      sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    },
    open: () => Promise.resolve(new Blob([bytes]).stream()),
  });
}

function receiveRecord(input: { receiver: SqliteReceiver; data: JsonObject; revision: number }) {
  return input.receiver.accept({
    ...owner,
    delivery: {
      version: 1,
      id: `delivery_${input.revision}`,
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
  await withReceiver(async (receiver) => {
    const count = 51;
    for (let index = 0; index < count; index++) {
      await receiveAsset({ receiver, id: String(index) });
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
    expect(new Set(all.map((asset) => asset.id)).size).toBe(count);
    expect(all.map((asset) => asset.id)).not.toContain(foreign);
    expect(all.map((asset) => asset.id)).not.toContain(anotherSource);
    expect(Object.keys(all[0]!).sort()).toEqual(['id', 'mediaType', 'name', 'size', 'sourceId']);
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

test('records link exact stored JSON and Markdown references to owned assets from the same source', async () => {
  await withReceiver(async (receiver) => {
    const first = await receiveAsset({ receiver, id: 'first' });
    const second = await receiveAsset({ receiver, id: 'second' });
    const unlinked = await receiveAsset({ receiver, id: 'unlinked' });
    const foreign = await receiveAsset({ receiver, id: 'foreign', scope: other });
    const anotherSource = await receiveAsset({ receiver, id: 'another', sourceId: 'other-source' });
    const url = (id: string) => `/api/receiver/assets/${id}`;
    const data = {
      attachments: [
        { name: 'same-name.txt', file: first },
        { name: 'same-name.txt', file: second },
      ],
      nested: [first, { url: url(second) }],
      body: `[first](${url(first)})\n\n![second][attachment]\n\n[attachment]: ${url(second)}`,
      literal: `\`[code](${url(unlinked)})\`\n\n\`\`\`\n[code](${url(unlinked)})\n\`\`\`\n\n[unused]: ${url(unlinked)}`,
      invalid: [
        foreign,
        anotherSource,
        'asset_00000000-0000-0000-0000-000000000000',
        `https://elsewhere.test${url(unlinked)}`,
      ],
    };
    await receiveRecord({ receiver, data, revision: 1 });
    const record = (await receiver.records({ ...owner, offset: 0 })).records[0]!;
    expect(record.data).toEqual(data);
    expect(record.assets.map((asset) => asset.id)).toEqual([first, second]);
    expect(record.assets.map((asset) => asset.name)).toEqual(['same-name.txt', 'same-name.txt']);
    expect((await receiver.records({ ...other, offset: 0 })).records).toEqual([]);
    await receiveRecord({
      receiver,
      data: { body: `[inline](${url(first)})\n\n[attachment][file]\n\n[file]: ${url(second)}` },
      revision: 2,
    });
    expect(
      (await receiver.records({ ...owner, offset: 0 })).records[0]!.assets.map((asset) => asset.id),
    ).toEqual([first, second]);
    await receiveRecord({ receiver, data: { body: 'No attachments now' }, revision: 3 });
    expect((await receiver.records({ ...owner, offset: 0 })).records[0]!.assets).toEqual([]);
  });
});
