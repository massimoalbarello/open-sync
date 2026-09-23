import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SyncRegistration } from '../src/models/definition';
import { DirectoryAssets } from '../src/repositories/assets/filesystem';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, fixture, page, savedSync, storage } from './support';

async function until(check: () => boolean | Promise<boolean>) {
  const deadlineMs = 2000;
  const deadline = Date.now() + deadlineMs;
  while (!(await check())) {
    if (Date.now() >= deadline) {
      throw new Error('Cleanup did not make progress');
    }
    await Bun.sleep(1);
  }
}

test('accepted files disappear while another source is still writing, and live files remain readable', async () => {
  const files = storage();
  const finish = Promise.withResolvers<void>();
  let slow = '';
  let staged = false;
  const delivered: string[] = [];
  const source: SyncRegistration = {
    ...fixture,
    load: () => ({
      async step(context) {
        const asset = await context.assets.capture({
          id: 'file',
          version: '1',
          name: 'file.txt',
          mediaType: 'text/plain',
          read: () =>
            Promise.resolve(
              context.syncId === slow
                ? new ReadableStream({
                    start(controller) {
                      controller.enqueue(new TextEncoder().encode('held'));
                      staged = true;
                      void finish.promise.then(() => {
                        try {
                          controller.close();
                        } catch {}
                      });
                    },
                  })
                : new Blob(['fast']).stream(),
            ),
        });
        return {
          ...page,
          complete: true,
          records: page.records.map((record) => ({ ...record, assetRefs: { file: asset } })),
        };
      },
    }),
  };
  const options = {
    databasePath: files.path,
    definitions: [source],
    destinationTypes: {
      local: {
        ...accepted,

        async deliver({ deliverable: delivery }: Parameters<typeof accepted.deliver>[0]) {
          const text = await new Response(await delivery.openAsset(delivery.assets![0]!)).text();
          expect(text).toBe(delivery.syncId === slow ? 'held' : 'fast');
          delivered.push(delivery.syncId);
          return { status: 'accepted' as const };
        },
      },
    },
  };
  const engine = createSyncRuntime(options);
  try {
    const destination = { type: 'local', input: {} };
    const first = await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination,
    });
    const second = await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination,
    });
    slow = second.id;
    engine.start();
    const db = new Database(files.path);
    try {
      await until(
        () =>
          staged &&
          delivered.includes(first.id) &&
          db.query<{ count: number }, []>('SELECT count(*) AS count FROM delivery_assets').get()!
            .count === 1,
      );
      expect(await readdir(`${files.path}.assets`)).toHaveLength(1);
      expect(savedSync({ path: files.path, scope: { ...alpha, id: second.id } }).checkpoint).toBe(
        0,
      );
      finish.resolve();
      await until(
        () =>
          delivered.length === 2 &&
          db.query<{ count: number }, []>('SELECT count(*) AS count FROM delivery_assets').get()!
            .count === 0,
      );
      expect(await readdir(`${files.path}.assets`)).toHaveLength(0);
    } finally {
      db.close();
    }
  } finally {
    finish.resolve();
    await engine.close();
    files.close();
  }
});

test('startup retries failed orphan deletion even with no runnable syncs', async () => {
  const files = storage();
  const directory = `${files.path}.assets`;
  await mkdir(directory);
  const orphan = join(directory, crypto.randomUUID());
  await writeFile(orphan, 'crash residue');
  await writeFile(join(directory, 'not-an-engine-file.txt'), 'preserve');
  const directoryFiles = new DirectoryAssets(directory);
  const remove = directoryFiles.remove.bind(directoryFiles);
  let failed = false;
  const deletion = spyOn(DirectoryAssets.prototype, 'remove').mockImplementation((id: string) => {
    if (!failed) {
      failed = true;
      return Promise.reject(new Error('Temporary filesystem failure'));
    }
    return remove(id);
  });
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [],
    destinationTypes: {},
    timing: { retryMs: 10 },
  });
  try {
    engine.start();
    await until(async () => !(await Bun.file(orphan).exists()));
    expect(failed).toBe(true);
    expect(await readdir(directory)).toEqual(['not-an-engine-file.txt']);
  } finally {
    deletion.mockRestore();
    await engine.close();
    files.close();
  }
});

test('a crash after releasing an asset reference retains its charge until recovery removes the file', async () => {
  const files = storage();
  const source: SyncRegistration = {
    ...fixture,
    load: () => ({
      async step({ assets }) {
        const ref = await assets.capture({
          id: 'file',
          version: '1',
          name: 'file',
          mediaType: 'text/plain',
          read: () => Promise.resolve(new Blob(['data']).stream()),
        });
        return {
          ...page,
          complete: true,
          records: page.records.map((record) => ({ ...record, assetRefs: { file: ref } })),
        };
      },
    }),
  };
  const options = {
    databasePath: files.path,
    definitions: [source],
    destinationTypes: { local: { ...accepted } },
  };
  const engine = createSyncRuntime(options);
  try {
    const destination = { type: 'local', input: {} };
    await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination,
    });
    await engine.tick();
    await engine.close();
    const db = new Database(files.path);
    // Persist the state at the crash boundary between reference release and unlink.
    db.exec('DELETE FROM deliveries;');
    expect(db.query('SELECT bytes FROM delivery_assets').get()).toEqual({ bytes: 4 });
    expect(await readdir(`${files.path}.assets`)).toHaveLength(1);
    const restarted = createSyncRuntime(options);
    try {
      restarted.start();
      await until(
        () =>
          db.query<{ count: number }, []>('SELECT count(*) AS count FROM delivery_assets').get()!
            .count === 0,
      );
      expect(await readdir(`${files.path}.assets`)).toHaveLength(0);
    } finally {
      await restarted.close();
      db.close();
    }
  } finally {
    await engine.close();
    files.close();
  }
});

test('releasing partial captures does not spin a capacity retry; acceptance wakes it after unlink', async () => {
  const files = storage();
  let accept = false;
  let reads = 0;
  const source: SyncRegistration = {
    ...fixture,
    load: () => ({
      async step(context) {
        const ids = context.config.count === 1 ? ['large'] : ['left', 'right'];
        const assets: import('../src/models/asset').AssetRef[] = [];
        for (const id of ids) {
          assets.push(
            await context.assets.capture({
              id,
              version: '1',
              name: id,
              mediaType: 'text/plain',
              read: () => {
                reads++;
                return Promise.resolve(new Blob([id === 'large' ? '1234' : '12']).stream());
              },
            }),
          );
        }
        return {
          ...page,
          complete: true,
          records: page.records.map((record) => ({
            ...record,
            assetRefs: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
          })),
        };
      },
    }),
  };
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [source],
    limits: { maxPendingAssetBytes: 6, maxSyncAssetBytes: 4 },
    destinationTypes: {
      local: {
        ...accepted,

        deliver: () =>
          Promise.resolve(accept ? { status: 'accepted' } : { status: 'rejected', code: 'hold' }),
      },
    },
  });
  try {
    const destination = { type: 'local', input: {} };
    await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination,
    });
    await engine.tick();
    const waiting = await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 2 },
      destination,
    });
    const scope = { ...alpha, id: waiting.id };
    engine.start();
    await until(
      async () =>
        engine.api.sync(scope).status === 'waiting_for_capacity' &&
        (await readdir(`${files.path}.assets`)).length === 1,
    );
    const before = reads;
    const observeMs = 50;
    await Bun.sleep(observeMs);
    expect(reads).toBe(before);
    expect(savedSync({ path: files.path, scope: scope }).checkpoint).toBe(0);
    accept = true;
    engine.api.retryDelivery({ ...alpha, id: engine.api.deliveries(alpha).deliveries[0]!.id });
    await until(
      () =>
        engine.api.sync(scope).status === 'succeeded' &&
        engine.api.status(alpha).queue.pendingRecords === 0,
    );
  } finally {
    await engine.close();
    files.close();
  }
});
