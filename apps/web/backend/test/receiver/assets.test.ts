import { expect, test } from 'bun:test';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';
import { assetResponse } from '#backend/routes/receiver/asset-response.ts';
import { bundle, fixture, scope, signal } from './fixture';

test('assets are verified and copied before acceptance; failures clean up and restart removes only orphan files', async () => {
  const f = await fixture();
  try {
    const deliverable = bundle();
    const identity = { scope, syncId: 'sync', id: deliverable.id, index: 0 };
    const available = deliverable.assets[0]!;
    if ('unavailable' in available) {
      throw new Error('Expected available asset');
    }
    for (const broken of [
      { ...available, id: 'oversized', size: 1 },
      { ...available, id: 'corrupt', sha256: 'wrong' },
    ]) {
      await expect(
        f.receiver.accept({
          scope,
          signal,
          deliverable: { ...deliverable, assets: [available, broken] },
        }),
      ).rejects.toThrow();
      expect(await readdir(f.assetDirectory)).toEqual([]);
      expect(await f.receiver.deliverable(identity)).toBeUndefined();
    }
    const controller = new AbortController();
    await expect(
      f.receiver.accept({
        scope,
        signal: controller.signal,
        deliverable: {
          ...deliverable,
          openAsset: () => {
            controller.abort(new Error('cancelled'));
            return Promise.resolve(new Blob(['file']).stream());
          },
        },
      }),
    ).rejects.toThrow('cancelled');
    expect(await readdir(f.assetDirectory)).toEqual([]);
    await f.receiver.accept({ scope, signal, deliverable });
    const committed = await readdir(f.assetDirectory);
    await writeFile(join(f.assetDirectory, crypto.randomUUID()), 'uncommitted');
    await writeFile(join(f.assetDirectory, 'unmanaged.txt'), 'leave alone');
    const receiver = await SqliteReceiver.open({ db: f.db, assetDirectory: f.assetDirectory });
    expect((await readdir(f.assetDirectory)).sort()).toEqual(
      [...committed, 'unmanaged.txt'].sort(),
    );
    const asset = (await receiver.asset(identity))!;
    expect(await new Response(asset.open()).text()).toBe('file');
    const response = assetResponse({ asset, range: 'bytes=1-2' });
    const partialContent = 206;
    expect(response.status).toBe(partialContent);
    expect(response.headers.get('content-range')).toBe('bytes 1-2/4');
    expect(await response.text()).toBe('il');
    for (const inaccessible of [
      { ...identity, scope: { actorId: 'bob', ownerId: 'bob' } },
      { ...identity, syncId: 'other' },
      { ...identity, id: 'other' },
      { ...identity, index: 1 },
    ]) {
      expect(await receiver.asset(inaccessible)).toBeUndefined();
    }
  } finally {
    await f.close();
  }
});
