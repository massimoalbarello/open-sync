import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Delivery } from '@context-use/open-sync/delivery';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';

const scope = { actorId: 'alice', ownerId: 'alice' };

test('record metadata survives restart and follows revision ordering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'receiver-metadata-'));
  const filename = join(directory, 'app.db');
  let db = new SQL({ adapter: 'sqlite', filename });
  try {
    await runMigrations({ db });
    let receiver = await SqliteReceiver.open({ db, assetDirectory: join(directory, 'assets') });
    const delivery: Delivery = {
      version: 1,
      id: 'metadata',
      ownerId: scope.ownerId,
      syncId: 'source',
      definition: 'test',
      deliverable: {
        records: [
          {
            operation: 'upsert',
            kind: 'item',
            id: 'record',
            revision: 2,
            eventId: 'event',
            contentHash: 'hash',
            data: { value: 1 },
            preview: 'Readable label',
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
          },
        ],
      },
    };
    await receiver.accept({ ...scope, delivery });
    await db.close();
    db = new SQL({ adapter: 'sqlite', filename });
    await runMigrations({ db });
    receiver = await SqliteReceiver.open({ db, assetDirectory: join(directory, 'assets') });
    await receiver.accept({ ...scope, delivery });
    const record = delivery.deliverable.records[0]!;
    await receiver.accept({
      ...scope,
      delivery: {
        ...delivery,
        id: 'stale',
        deliverable: { records: [{ ...record, revision: 1 }] },
      },
    });
    expect((await receiver.records({ ...scope, offset: 0 })).records[0]).toMatchObject({
      revision: 2,
      preview: 'Readable label',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
    });
    const nextRevision = 3;
    await receiver.accept({
      ...scope,
      delivery: {
        ...delivery,
        id: 'clear',
        deliverable: {
          records: [
            {
              operation: 'upsert',
              kind: 'item',
              id: 'record',
              revision: nextRevision,
              eventId: 'clear',
              contentHash: 'clear',
              data: { value: 1 },
            },
          ],
        },
      },
    });
    const cleared = (await receiver.records({ ...scope, offset: 0 })).records[0]!;
    expect(cleared).not.toHaveProperty('preview');
    expect(cleared).not.toHaveProperty('createdAt');
    expect(cleared).not.toHaveProperty('updatedAt');
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
