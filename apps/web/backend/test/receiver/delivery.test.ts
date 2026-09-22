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
    version: '1',
    artifactId: 'attachment/1',
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
        deliverable: {
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
        },
        checkpoint: 1,
        complete: true,
      };
    },
  }),
};

test('pausing a destination holds assets and records without consuming asset attempts', async () => {
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
      timing: { assetAttempts: 1 },
    });
    const destination = runtime.api.createDestination({ ...owner, type: 'local', config: {} });
    await runtime.api.createInstallation({
      ...owner,
      definition: source.definition,
      config: {},
      destinationId: destination.id,
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
        sourceId: record.sourceId,
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
