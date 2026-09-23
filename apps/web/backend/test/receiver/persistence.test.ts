import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Delivery } from '@context-use/open-sync/delivery';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';

const scope = { actorId: 'alice', ownerId: 'alpha' };
const delivery: Delivery = {
  version: 1,
  id: 'delivery_1',
  ownerId: scope.ownerId,
  syncId: 'source_1',
  definition: 'test',
  deliverable: {
    records: [
      {
        operation: 'upsert',
        kind: 'item',
        id: 'a',
        data: { value: 1 },
        content: { format: 'markdown', body: '# Hello' },
        revision: 1,
        contentHash: 'hash_1',
        eventId: 'event_1',
      },
    ],
  },
};

test('local receiver atomically deduplicates whole deliveries and keeps owner data isolated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'receiver-test-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  try {
    await runMigrations({ db });
    const receiver = await SqliteReceiver.open({ db, assetDirectory: join(dir, 'assets') });
    await db.unsafe(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON host_receipts BEGIN SELECT RAISE(ABORT,'injected'); END;",
    );
    await expect(receiver.accept({ ...scope, delivery })).rejects.toThrow('injected');
    expect((await receiver.status(scope)).records).toBe(0);
    await db.unsafe('DROP TRIGGER fail_receipt');
    await receiver.accept({ ...scope, delivery });
    await receiver.accept({ ...scope, delivery });
    expect(await receiver.status(scope)).toEqual({ records: 1, receipts: 1, paused: false });
    expect((await receiver.status({ actorId: 'bob', ownerId: 'beta' })).records).toBe(0);
    await expect(receiver.accept({ actorId: 'bob', ownerId: 'beta', delivery })).rejects.toThrow(
      'owner mismatch',
    );
    expect(await receiver.records({ ...scope, offset: 0 })).toMatchObject({
      records: [{ syncId: 'source_1', kind: 'item', id: 'a', revision: 1, data: { value: 1 } }],
      hasMore: false,
    });
    expect(
      (await receiver.records({ actorId: 'bob', ownerId: 'beta', offset: 0 })).records,
    ).toEqual([]);
    expect((await receiver.records({ ...scope, syncId: 'other', offset: 0 })).records).toEqual([]);
    const identity = { ...scope, syncId: 'source_1', kind: 'item', id: 'a' };
    expect(await receiver.record(identity)).toMatchObject({
      content: { format: 'markdown', body: '# Hello' },
    });
    expect(await receiver.record({ ...identity, ownerId: 'beta', actorId: 'bob' })).toBeUndefined();
    expect(await receiver.record({ ...identity, syncId: 'other' })).toBeUndefined();
    expect(await receiver.record({ ...identity, kind: 'other' })).toBeUndefined();
    const changed = structuredClone(delivery);
    changed.deliverable.records[0]!.revision++;
    await expect(receiver.accept({ ...scope, delivery: changed })).rejects.toThrow(
      'different content',
    );
    await receiver.setPaused({ ...scope, paused: true });
    expect(await receiver.accept({ ...scope, delivery: { ...delivery, id: 'delivery_2' } })).toBe(
      false,
    );
    expect((await receiver.status(scope)).receipts).toBe(1);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('record browsing preserves unrelated JSON schemas, pagination and deletions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'receiver-records-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  try {
    await runMigrations({ db });
    const receiver = await SqliteReceiver.open({ db, assetDirectory: join(dir, 'assets') });
    const count = 51;
    const records = [...Array(count).keys()].map((index) => ({
      operation: 'upsert' as const,
      kind: 'measurement',
      id: String(index).padStart(2, '0'),
      data: { temperature: index, coordinates: [1, 2], enabled: true },
      ...(index === 1
        ? { createdAt: '2026-09-01T00:00:00.000Z' }
        : { updatedAt: '2026-01-01T00:00:00.000Z' }),
      revision: 1,
      contentHash: `hash_${index}`,
      eventId: `event_${index}`,
    }));
    await receiver.accept({ ...scope, delivery: { ...delivery, deliverable: { records } } });
    const updatedAt = '2026-01-02T00:00:00.000Z';
    const updated = {
      ...delivery,
      id: 'updated',
      deliverable: { records: [{ ...records.at(-1)!, revision: 2, updatedAt }] },
    };
    await receiver.accept({ ...scope, delivery: updated });
    const first = await receiver.records({ ...scope, offset: 0 });
    expect(first.hasMore).toBe(true);
    expect(first.records[0]!.data).toEqual({ temperature: 50, coordinates: [1, 2], enabled: true });
    expect(first.records[0]!.updatedAt).toBe(updatedAt);
    const last = await receiver.records({ ...scope, offset: first.pageSize });
    expect(last.records).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    expect(last.records[0]!.id).toBe('01');
    expect(last.records[0]).not.toHaveProperty('updatedAt');
    expect([...first.records, ...last.records].map((record) => record.id)).toEqual([
      '50',
      '00',
      ...records.slice(2, -1).map((record) => record.id),
      '01',
    ]);
    await receiver.accept({ ...scope, delivery: updated });
    await receiver.accept({
      ...scope,
      delivery: { ...delivery, id: 'stale', deliverable: { records: [records.at(-1)!] } },
    });
    expect(
      (await receiver.record({ ...scope, syncId: 'source_1', kind: 'measurement', id: '50' }))!
        .updatedAt,
    ).toBe(updatedAt);
    await receiver.accept({
      ...scope,
      delivery: {
        ...delivery,
        id: 'deletion',
        deliverable: {
          records: [
            {
              operation: 'delete',
              kind: 'measurement',
              id: '00',
              revision: 2,
              contentHash: 'deleted',
              eventId: 'delete_1',
            },
          ],
        },
      },
    });
    expect((await receiver.records({ ...scope, offset: 0 })).records[0]!.id).toBe('50');
    expect(
      await receiver.record({ ...scope, syncId: 'source_1', kind: 'measurement', id: '00' }),
    ).toBeUndefined();
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
