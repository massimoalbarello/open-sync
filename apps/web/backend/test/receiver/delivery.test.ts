import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SyncRegistration } from '@context-use/open-sync/definition';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { localDestination } from '@open-sync/examples/destinations/local';
import { bundle, fixture, scope } from './fixture';

test('lost acceptance acknowledgements replay after restart without duplicate bundles or files', async () => {
  const f = await fixture();
  let runtime: ReturnType<typeof createSyncRuntime> | undefined;
  try {
    let loseAck = true;
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
            read: () => Promise.resolve(new Blob(['file']).stream()),
          });
          const { revision: _, ...record } = bundle().records[0]!;
          return {
            records: [{ ...record, assetRefs: { file } }],
            checkpoint: 1,
            complete: true,
          };
        },
      }),
    };
    const destination = localDestination({ accept: (input) => f.receiver.accept(input) });
    const options = {
      databasePath: join(f.directory, 'sync.db'),
      definitions: [source],
      destinationTypes: {
        local: {
          ...destination,
          async deliver(input: Parameters<typeof destination.deliver>[0]) {
            const result = await destination.deliver(input);
            if (loseAck) {
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
      ...scope,
      definition: source.definition.id,
      config: {},
      destination: { type: 'local', input: {} },
    });
    await runtime.tick();
    await runtime.tick();
    const queued = runtime.api.deliveries({ ...scope, syncId: sync.id }).deliveries[0]!;
    const saved = await f.receiver.deliverable({ scope, syncId: sync.id, id: queued.id });
    expect(saved?.deliverable.records[0]).toMatchObject({
      data: { file: 'open-sync-asset:file' },
    });
    expect(await readdir(f.assetDirectory)).toHaveLength(1);
    await runtime.close();
    runtime = createSyncRuntime(options);
    runtime.api.retryDelivery({ ...scope, syncId: sync.id, id: queued.id });
    await runtime.tick();
    expect(runtime.api.status(scope).queue.pendingDeliveries).toBe(0);
    expect(await f.receiver.deliverable({ scope, syncId: sync.id, id: queued.id })).toEqual(saved);
    expect((await f.receiver.deliverables({ scope, syncId: sync.id })).deliverables).toHaveLength(
      1,
    );
    expect(await readdir(f.assetDirectory)).toHaveLength(1);
    await runtime.api.removeSync({ ...scope, id: sync.id });
    const asset = await f.receiver.asset({ scope, syncId: sync.id, id: queued.id, index: 0 });
    expect(await new Response(asset!.open()).text()).toBe('file');
  } finally {
    await runtime?.close();
    await f.close();
  }
});
