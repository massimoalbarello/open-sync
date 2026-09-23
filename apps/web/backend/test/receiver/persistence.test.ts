import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { bundle, fixture, scope, signal } from './fixture';

test('whole deliverables commit atomically, preserve the original bundle, and reject conflicting replay', async () => {
  const f = await fixture();
  try {
    const deliverable = bundle();
    const { openAsset: _, ...body } = deliverable;
    await f.db.unsafe(
      "CREATE TRIGGER fail_accept BEFORE INSERT ON host_deliverables BEGIN SELECT RAISE(ABORT,'injected'); END;",
    );
    await expect(f.receiver.accept({ scope, deliverable, signal })).rejects.toThrow('injected');
    expect((await f.receiver.deliverables({ scope, syncId: 'sync' })).deliverables).toEqual([]);
    expect(await readdir(f.assetDirectory)).toEqual([]);
    await f.db.unsafe('DROP TRIGGER fail_accept');
    await Promise.all([
      f.receiver.accept({ scope, deliverable, signal }),
      f.receiver.accept({ scope, deliverable, signal }),
    ]);
    const saved = await f.receiver.deliverable({ scope, syncId: 'sync', id: deliverable.id });
    expect(saved?.deliverable).toEqual(body);
    expect((await f.receiver.deliverables({ scope, syncId: 'sync' })).deliverables).toHaveLength(1);
    expect(await readdir(f.assetDirectory)).toHaveLength(1);
    await f.receiver.accept({
      scope,
      signal,
      deliverable: {
        ...deliverable,
        openAsset: () => Promise.reject(new Error('already persisted')),
      },
    });
    expect(await f.receiver.deliverable({ scope, syncId: 'sync', id: deliverable.id })).toEqual(
      saved,
    );
    await expect(
      f.receiver.accept({ scope, signal, deliverable: { ...deliverable, definition: 'changed' } }),
    ).rejects.toThrow('different content');
    await expect(
      f.receiver.accept({ scope: { actorId: 'bob', ownerId: 'bob' }, signal, deliverable }),
    ).rejects.toThrow('owner mismatch');
    expect(
      await f.receiver.deliverable({
        scope: { actorId: 'bob', ownerId: 'bob' },
        syncId: 'sync',
        id: deliverable.id,
      }),
    ).toBeUndefined();
    expect(
      await f.receiver.deliverable({ scope, syncId: 'other', id: deliverable.id }),
    ).toBeUndefined();
  } finally {
    await f.close();
  }
});

test('deliverables paginate by stable cursor without duplicates when new deliveries arrive', async () => {
  const f = await fixture();
  try {
    const count = 23;
    for (let index = 0; index < count; index++) {
      await f.receiver.accept({
        scope,
        signal,
        deliverable: { ...bundle(String(index)), assets: [] },
      });
    }
    const first = await f.receiver.deliverables({ scope, syncId: 'sync' });
    const pageSize = 20;
    expect(first.deliverables).toHaveLength(pageSize);
    expect(first.deliverables[0]).toMatchObject({ id: '22', recordCount: 1, assetCount: 0 });
    expect(first.nextCursor).not.toBeNull();
    await f.receiver.accept({ scope, signal, deliverable: { ...bundle('new'), assets: [] } });
    const last = await f.receiver.deliverables({
      scope,
      syncId: 'sync',
      before: first.nextCursor!,
    });
    expect(last.deliverables.map((row) => row.id)).toEqual(['2', '1', '0']);
    expect(last.nextCursor).toBeNull();
    expect(new Set([...first.deliverables, ...last.deliverables].map((row) => row.id)).size).toBe(
      count,
    );
    for (const input of [
      { scope: { actorId: 'bob', ownerId: 'bob' }, syncId: 'sync' },
      { scope, syncId: 'other' },
    ]) {
      expect(await f.receiver.deliverables(input)).toEqual({ deliverables: [], nextCursor: null });
    }
  } finally {
    await f.close();
  }
});
