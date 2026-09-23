import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';

const owner = { actorId: 'alice', ownerId: 'alice' };
test('receiver owns its bytes and stable asset IDs, checks integrity, and isolates owners', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'receiver-assets-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  const assetDirectory = join(dir, 'assets');
  try {
    await runMigrations({ db });
    let receiver = await SqliteReceiver.open({ db, assetDirectory });
    const bytes = Buffer.from('00ff0d0a', 'hex');
    const input = {
      ...owner,
      syncId: 'source',
      idempotencyKey: 'upload',
      signal: new AbortController().signal,
      asset: {
        id: 'file',
        version: '1',
        name: '../untrusted.bin',
        mediaType: 'application/octet-stream',
        size: bytes.length,
        sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
      },
      open: () => Promise.resolve(new Blob([bytes]).stream()),
    };
    const id = await receiver.acceptAsset(input);
    const committedFiles = await readdir(assetDirectory);
    const orphan = crypto.randomUUID();
    await writeFile(join(assetDirectory, orphan), 'interrupted upload');
    await writeFile(join(assetDirectory, 'keep.txt'), 'unmanaged file');
    receiver = await SqliteReceiver.open({ db, assetDirectory });
    expect((await readdir(assetDirectory)).sort()).toEqual([...committedFiles, 'keep.txt'].sort());
    await rm(join(assetDirectory, 'keep.txt'));
    expect(
      await receiver.acceptAsset({
        ...input,
        open: () => Promise.reject(new Error('Must reuse receipt')),
      }),
    ).toBe(id);
    const asset = await receiver.asset({ ...owner, id });
    expect(Buffer.from(await new Response(asset!.open()).arrayBuffer())).toEqual(bytes);
    const range = { start: 1, end: 3 };
    expect(Buffer.from(await new Response(asset!.open(range)).arrayBuffer())).toEqual(
      bytes.subarray(range.start, range.end),
    );
    expect(await receiver.assetInfo({ ...owner, id })).toMatchObject({
      id,
      name: '../untrusted.bin',
      size: bytes.length,
    });
    expect(await receiver.assetInfo({ actorId: 'bob', ownerId: 'bob', id })).toBeUndefined();
    expect(await receiver.asset({ actorId: 'bob', ownerId: 'bob', id })).toBeUndefined();
    expect(await readdir(assetDirectory)).toHaveLength(1);
    await expect(
      receiver.acceptAsset({
        ...input,
        idempotencyKey: 'bad',
        asset: { ...input.asset, id: 'corrupt', sha256: 'wrong' },
      }),
    ).rejects.toThrow('content mismatch');
    expect(await readdir(assetDirectory)).toHaveLength(1);
    await expect(
      receiver.acceptAsset({ ...input, asset: { ...input.asset, name: 'changed.bin' } }),
    ).rejects.toThrow('identity reused');
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
