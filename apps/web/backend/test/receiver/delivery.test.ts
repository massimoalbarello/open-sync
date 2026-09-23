import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetPlaceholder } from '@context-use/open-sync/assets';
import type { SyncRegistration } from '@context-use/open-sync/definition';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { localDestination } from '@open-sync/examples/destinations/local';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';

const owner = { actorId: 'alice', ownerId: 'alice' };
const source: SyncRegistration = {
  definition: {
    id: 'attachment',

    configSchema: { type: 'object' },
    checkpointSchema: { type: 'integer' },
    initialCheckpoint: 0,
    kinds: { note: { type: 'object' } },
  },
  load: () => ({
    async step({ assets }) {
      const file = await assets.capture({
        id: 'file',
        version: '1',
        name: 'file.txt',
        mediaType: 'text/plain',
        createdAt: '2020-01-01T01:00:00+01:00',
        updatedAt: '2020-01-02T00:00:00Z',
        read: () => Promise.resolve(new Blob(['attachment']).stream()),
      });
      return {
        records: [
          {
            operation: 'upsert',
            kind: 'note',
            id: 'record',
            data: { label: 'Attachment' },
            content: { format: 'markdown', body: `[file](${assetPlaceholder('file')})` },
            preview: ' An attached\nfile ',
            createdAt: '2020-01-01T01:00:00+01:00',
            assetRefs: { file },
          },
        ],
        checkpoint: 1,
        complete: true,
      };
    },
  }),
};

test('pausing a destination holds assets and records without uploading either', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'receiver-delivery-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  let runtime: ReturnType<typeof createSyncRuntime> | undefined;
  try {
    await runMigrations({ db });
    const receiver = await SqliteReceiver.open({ db, assetDirectory: join(dir, 'received') });
    await receiver.setPaused({ ...owner, paused: true });
    expect(await receiver.isPaused({ actorId: 'bob', ownerId: 'bob' })).toBe(false);
    runtime = createSyncRuntime({
      databasePath: join(dir, 'sync.db'),
      definitions: [source],
      destinationTypes: {
        local: localDestination({
          isPaused: (scope) => receiver.isPaused(scope),
          accept: (input) => receiver.accept(input),
          acceptAsset: (input) => receiver.acceptAsset(input),
        }),
      },
    });
    const destination = { type: 'local', input: {} };
    await runtime.api.createSync({
      ...owner,
      definition: source.definition.id,
      config: {},
      destination,
    });
    await runtime.tick();
    const queued = runtime.api.deliveries(owner).deliveries[0]!;
    const pausedAttempts = 3;
    for (let attempt = 0; attempt < pausedAttempts; attempt++) {
      runtime.api.retryDelivery({ ...owner, id: queued.id });
      await runtime.tick();
      expect((await receiver.assets({ ...owner, offset: 0 })).assets).toEqual([]);
      expect((await receiver.status(owner)).records).toBe(0);
      expect(runtime.api.deliveries(owner).deliveries[0]?.errorCode).toBe('receiver_paused');
    }
    await receiver.setPaused({ ...owner, paused: false });
    runtime.api.retryDelivery({ ...owner, id: queued.id });
    await runtime.tick();
    const record = (await receiver.records({ ...owner, offset: 0 })).records[0]!;
    expect(record.assets).toHaveLength(1);
    expect(record.content?.body).toContain(`/api/receiver/assets/${record.assets[0]!.id}`);
    expect(record.content?.body).not.toContain('open-sync-asset:');
    expect(record).toMatchObject({
      preview: 'An attached file',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    expect(record).not.toHaveProperty('updatedAt');
    const listed = (await receiver.assets({ ...owner, offset: 0 })).assets[0]!;
    expect(listed).toMatchObject({
      name: 'file.txt',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
    });
    expect(record.assets[0]).toEqual(listed);
    expect(await receiver.assetInfo({ ...owner, id: listed.id })).toEqual(listed);
    expect(
      await receiver.record({
        ...owner,
        syncId: record.syncId,
        kind: record.kind,
        id: record.id,
      }),
    ).toEqual(record);
    expect(listed).not.toHaveProperty('preview');
    const asset = await receiver.asset({ ...owner, id: record.assets[0]!.id });
    expect(await new Response(asset!.open()).text()).toBe('attachment');
    expect(runtime.api.status(owner).queue.pendingDeliveries).toBe(0);
  } finally {
    await runtime?.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('local destination owns repeated uploads, unavailable recovery, and descriptor changes across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'receiver-replay-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  let runtime: ReturnType<typeof createSyncRuntime> | undefined;
  let available = false;
  let name = 'file.txt';
  let loseAck = false;
  let uploads = 0;
  try {
    await runMigrations({ db });
    const receiver = await SqliteReceiver.open({ db, assetDirectory: join(dir, 'received') });
    const local = localDestination({
      isPaused: (scope) => receiver.isPaused(scope),
      accept: (input) => receiver.accept(input),
      acceptAsset: (input) => {
        uploads++;
        return receiver.acceptAsset(input);
      },
    });
    const options = {
      databasePath: join(dir, 'sync.db'),
      definitions: [
        {
          ...source,
          load: () => ({
            async step(context: import('@context-use/open-sync/definition').SyncContext) {
              const original = await source.load();
              return original.step({
                ...context,
                assets: {
                  ...context.assets,
                  capture: (capture) =>
                    available
                      ? context.assets.capture({ ...capture, name })
                      : Promise.resolve(
                          context.assets.unavailable({ ...capture, name, code: 'not_exposed' }),
                        ),
                },
              });
            },
          }),
        },
      ],
      destinationTypes: {
        local: {
          ...local,
          async deliver(input: Parameters<typeof local.deliver>[0]) {
            const result = await local.deliver(input);
            if (loseAck && result.status === 'accepted') {
              loseAck = false;
              throw new Error('lost acknowledgement');
            }
            return result;
          },
        },
      },
    };
    runtime = createSyncRuntime(options);
    const sync = await runtime.api.createSync({
      ...owner,
      definition: source.definition.id,
      config: {},
      destination: { type: 'local', input: {} },
    });
    const scope = { ...owner, id: sync.id };
    await runtime.tick();
    await runtime.tick();
    expect((await receiver.records({ ...owner, offset: 0 })).records[0]).toMatchObject({
      revision: 1,
      assets: [],
    });
    expect(uploads).toBe(0);
    available = true;
    loseAck = true;
    runtime.api.queueRun(scope);
    await runtime.tick();
    await runtime.tick();
    const queued = runtime.api.deliveries(owner).deliveries[0]!;
    expect(uploads).toBe(1);
    await runtime.close();
    runtime = createSyncRuntime(options);
    runtime.api.retryDelivery({ ...owner, id: queued.id });
    await runtime.tick();
    expect(uploads).toBe(2);
    const before = (await receiver.records({ ...owner, offset: 0 })).records[0]!;
    expect(before.revision).toBe(2);
    expect(before.assets).toHaveLength(1);
    name = 'renamed.txt';
    runtime.api.queueRun(scope);
    await runtime.tick();
    await runtime.tick();
    const after = (await receiver.records({ ...owner, offset: 0 })).records[0]!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.assets[0]).toMatchObject({ id: before.assets[0]!.id, name });
    expect(runtime.api.status(owner).queue.pendingDeliveries).toBe(0);
  } finally {
    await runtime?.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
