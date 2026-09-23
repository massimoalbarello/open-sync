import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { type AssetMetadata, assetPlaceholder } from '../src/models/asset';
import type { SyncContext, SyncRegistration, SyncStep } from '../src/models/definition';
import type { Deliverable, DestinationType } from '../src/models/delivery';
import { defaultLimits } from '../src/models/limits';
import { DirectoryAssets } from '../src/repositories/assets/filesystem';
import { SqliteAssets } from '../src/repositories/assets/sqlite';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, beta, fixture, repositories, savedSync, storage } from './support';

const leaseMs = 60_000;
const pollCount = 3;
const changedRevisions = [1, 2, pollCount];
const metadata: AssetMetadata = {
  id: 'file',
  version: '1',
  name: 'file.txt',
  mediaType: 'text/plain',
};
const bytes = () => Promise.resolve(new Blob(['attachment']).stream());
function record(ref: { id: string; version: string }) {
  return {
    operation: 'upsert' as const,
    kind: 'item',
    id: 'record',
    data: { file: assetPlaceholder('file') },
    assetRefs: { file: { id: ref.id, version: ref.version } },
  };
}
function page(ref: { id: string; version: string }): SyncStep {
  return { records: [record(ref)], checkpoint: 1, complete: true };
}
async function harness(input: {
  step(context: SyncContext): Promise<SyncStep>;
  destination?: DestinationType;
  limits?: Parameters<typeof createSyncRuntime>[0]['limits'];
}) {
  const files = storage();
  const source: SyncRegistration = {
    ...fixture,
    definition: { ...fixture.definition, kinds: { item: { type: 'object' } } },
    load: () => ({ step: input.step }),
  };
  const options = {
    databasePath: files.path,
    definitions: [source],
    destinationTypes: { local: input.destination ?? accepted },
    limits: input.limits,
  };
  let engine = createSyncRuntime(options);
  const sync = await engine.api.createSync({
    ...alpha,
    definition: source.definition.id,
    config: { count: 1 },
    destination: { type: 'local', input: {} },
  });
  const scope = { ...alpha, id: sync.id };
  return {
    files,
    scope,
    get engine() {
      return engine;
    },
    get saved() {
      return savedSync({ path: files.path, scope });
    },
    ledger() {
      const db = new Database(files.path, { readonly: true });
      try {
        return db
          .query<{ bytes: number; count: number }, []>(
            'SELECT coalesce(sum(bytes),0) AS bytes,count(*) AS count FROM delivery_assets',
          )
          .get()!;
      } finally {
        db.close();
      }
    },
    async poll() {
      engine.api.queueRun(scope);
      await engine.tick();
      await engine.tick();
    },
    async restart() {
      await engine.close();
      engine = createSyncRuntime(options);
    },
    async close() {
      await engine.close();
      files.close();
    },
  };
}

test('a deliverable bundles original records, descriptors, and independently readable streams', async () => {
  const received: Deliverable[] = [];
  const f = await harness({
    step: async ({ assets }) => page(await assets.capture({ ...metadata, read: bytes })),
    destination: {
      ...accepted,
      async deliver({ deliverable }) {
        received.push(deliverable);
        expect(deliverable.assets).toMatchObject([{ ...metadata, size: 10 }]);
        expect(deliverable.records[0]).toMatchObject(record(metadata));
        for (const asset of deliverable.assets) {
          expect(await new Response(await deliverable.openAsset(asset)).text()).toBe('attachment');
          expect(await new Response(await deliverable.openAsset(asset)).text()).toBe('attachment');
        }
        await expect(deliverable.openAsset({ id: 'foreign', version: '1' })).rejects.toThrow(
          'not found',
        );
        return { status: 'accepted' };
      },
    },
  });
  try {
    await f.engine.tick();
    expect(f.ledger()).toEqual({ count: 1, bytes: 10 });
    await f.engine.tick();
    expect(received).toHaveLength(1);
    expect(received[0]!.syncId).toBe(f.scope.id);
    expect(f.ledger()).toEqual({ count: 0, bytes: 0 });
    expect(await readdir(`${f.files.path}.assets`)).toEqual([]);
    await expect(received[0]!.openAsset(metadata)).rejects.toThrow('lease lost');
  } finally {
    await f.close();
  }
});

test('lost acknowledgement and restart replay the original ID, records, descriptors and bytes', async () => {
  let reads = 0;
  const received: string[] = [];
  let attempts = 0;
  const f = await harness({
    step: async ({ assets }) =>
      page(
        await assets.capture({
          ...metadata,
          read: () => {
            reads++;
            return bytes();
          },
        }),
      ),
    destination: {
      ...accepted,
      async deliver({ deliverable }) {
        const { openAsset, ...body } = deliverable;
        received.push(JSON.stringify(body));
        expect(await new Response(await openAsset(metadata)).text()).toBe('attachment');
        // Destination may mutate its copy; it must not alter the queued payload.
        deliverable.records.length = 0;
        if (++attempts === 1) {
          throw new Error('receiver committed; acknowledgement lost');
        }
        return { status: 'accepted' };
      },
    },
  });
  try {
    await f.engine.tick();
    await f.engine.tick();
    expect(f.ledger().bytes).toBe(10);
    await f.restart();
    const queued = f.engine.api.deliveries(alpha).deliveries[0]!;
    f.engine.api.retryDelivery({ ...alpha, id: queued.id });
    await f.engine.tick();
    expect(received).toHaveLength(2);
    expect(received[0]).toBe(received[1]);
    expect(reads).toBe(1);
    expect(f.ledger().count).toBe(0);
  } finally {
    await f.close();
  }
});

test('later deliveries download again and unchanged records release all new captures', async () => {
  let reads = 0;
  let value = 1;
  const received: Deliverable[] = [];
  const f = await harness({
    step: async ({ assets }) => {
      const ref = await assets.capture({
        ...metadata,
        read: () => {
          reads++;
          return bytes();
        },
      });
      return { ...page(ref), records: [{ ...record(ref), data: { value } }] };
    },
    destination: {
      ...accepted,
      deliver: ({ deliverable }) => {
        received.push(deliverable);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    await f.poll();
    await f.poll();
    expect(reads).toBe(2);
    expect(received).toHaveLength(1);
    expect(f.ledger().count).toBe(0);
    value = 2;
    await f.poll();
    expect(reads).toBe(pollCount);
    expect(received).toHaveLength(2);
    expect(received[1]!.id).not.toBe(received[0]!.id);
    expect(received[1]!.assets).toEqual(received[0]!.assets);
  } finally {
    await f.close();
  }
});

test('asset descriptor changes and unavailable-to-available recovery change the record hash', async () => {
  let available = false;
  let name = 'first.txt';
  const received: Deliverable[] = [];
  const f = await harness({
    step: async ({ assets }) =>
      page(
        available
          ? await assets.capture({ ...metadata, name, read: bytes })
          : assets.unavailable({ ...metadata, name, code: 'not_exposed' }),
      ),
    destination: {
      ...accepted,
      deliver: ({ deliverable }) => {
        received.push(deliverable);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    await f.poll();
    available = true;
    await f.poll();
    name = 'renamed.txt';
    await f.poll();
    await f.poll();
    expect(received).toHaveLength(changedRevisions.length);
    expect(received.map((d) => d.records[0]!.revision)).toEqual(changedRevisions);
    expect(received[0]!.assets[0]).toHaveProperty('unavailable', 'not_exposed');
    expect(received[1]!.assets[0]).toHaveProperty('size', 10);
    expect(received[2]!.assets[0]).toHaveProperty('name', 'renamed.txt');
  } finally {
    await f.close();
  }
});

test('unrelated captures and reference ordering do not change records', async () => {
  let reverse = false;
  let otherName = 'other';
  const received: Deliverable[] = [];
  const f = await harness({
    step: async ({ assets }) => {
      const refs = [];
      for (const id of reverse ? ['b', 'a'] : ['a', 'b']) {
        refs.push(await assets.capture({ ...metadata, id, read: bytes }));
      }
      await assets.capture({ ...metadata, id: 'unused', name: otherName, read: bytes });
      return {
        records: [
          {
            ...record(refs[0]!),
            assetRefs: Object.fromEntries(refs.map((ref) => [ref.id, ref])),
            data: {},
          },
        ],
        checkpoint: 1,
        complete: true,
      };
    },
    destination: {
      ...accepted,
      deliver: ({ deliverable }) => {
        received.push(deliverable);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    await f.poll();
    reverse = true;
    otherName = 'changed unused descriptor';
    await f.poll();
    expect(received).toHaveLength(1);
    expect(received[0]!.assets.map((a) => a.id)).toEqual(['a', 'b']);
    expect(f.ledger().count).toBe(0);
  } finally {
    await f.close();
  }
});

test('concurrent captures shared by several records download once per step', async () => {
  let reads = 0;
  const f = await harness({
    step: async ({ assets }) => {
      const capture = {
        ...metadata,
        read: () => {
          reads++;
          return bytes();
        },
      };
      const [left, right] = await Promise.all([assets.capture(capture), assets.capture(capture)]);
      return {
        records: [record(left), { ...record(right), id: 'second' }],
        checkpoint: 1,
        complete: true,
      };
    },
  });
  try {
    await f.engine.tick();
    expect(reads).toBe(1);
    expect(f.ledger().count).toBe(1);
    expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(2);
  } finally {
    await f.close();
  }
});

test('conflicting descriptors within one step fail atomically', async () => {
  const f = await harness({
    step: async ({ assets }) => {
      await assets.capture({ ...metadata, read: bytes });
      return page(await assets.capture({ ...metadata, name: 'conflict', read: bytes }));
    },
  });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toBe(0);
    expect(f.saved.status).toBe('asset_version_conflict');
    expect(f.ledger().count).toBe(0);
  } finally {
    await f.close();
  }
});

test('partial reads fail the whole step on every retry, never becoming an unavailable success', async () => {
  let fail = true;
  let reads = 0;
  const f = await harness({
    step: async ({ assets }) =>
      page(
        await assets.capture({
          ...metadata,
          read: () => {
            reads++;
            return Promise.resolve(
              fail
                ? new ReadableStream<Uint8Array>({
                    start(c) {
                      c.enqueue(new TextEncoder().encode('partial'));
                    },
                    pull() {
                      throw new Error('network failed');
                    },
                  })
                : new Blob(['complete']).stream(),
            );
          },
        }),
      ),
  });
  try {
    const failures = 4;
    for (let i = 0; i < failures; i++) {
      f.engine.api.queueRun(f.scope);
      await f.engine.tick();
      expect(f.saved.checkpoint).toBe(0);
      expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(0);
      expect(f.ledger().count).toBe(0);
    }
    await f.restart();
    fail = false;
    await f.poll();
    expect(reads).toBe(failures + 1);
    expect(f.saved.checkpoint).toBe(1);
  } finally {
    await f.close();
  }
});

test('known unavailable assets remain explicit and have no stream', async () => {
  let received = false;
  const f = await harness({
    step: ({ assets }) =>
      Promise.resolve(page(assets.unavailable({ ...metadata, code: 'not_exposed' }))),
    destination: {
      ...accepted,
      async deliver({ deliverable }) {
        expect(deliverable.assets[0]).toHaveProperty('unavailable', 'not_exposed');
        await expect(deliverable.openAsset(metadata)).rejects.toThrow('asset content missing');
        received = true;
        return { status: 'accepted' };
      },
    },
  });
  try {
    await f.poll();
    expect(received).toBe(true);
    expect(f.ledger().count).toBe(0);
  } finally {
    await f.close();
  }
});

test('cleanup failure retains the file reservation until unlink succeeds', async () => {
  const f = await harness({
    step: async ({ assets }) => page(await assets.capture({ ...metadata, read: bytes })),
  });
  let deletion: ReturnType<typeof spyOn> | undefined;
  try {
    await f.engine.tick();
    deletion = spyOn(DirectoryAssets.prototype, 'remove').mockRejectedValue(
      new Error('unlink failed'),
    );
    await expect(f.engine.tick()).rejects.toThrow('unlink failed');
    expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(0);
    expect(f.ledger()).toEqual({ bytes: 10, count: 1 });
    expect(await readdir(`${f.files.path}.assets`)).toHaveLength(1);
    deletion.mockRestore();
    deletion = undefined;
    await f.engine.tick();
    expect(f.ledger().count).toBe(0);
  } finally {
    deletion?.mockRestore();
    await f.close();
  }
});

test('stale acquisition generations cannot retain or queue old staged assets', () => {
  const f = repositories();
  try {
    const lease = f.acquisition.claim(leaseMs)!;
    const assets = new SqliteAssets({
      db: f.db,
      maxBytes: defaultLimits.maxPendingAssetBytes,
      maxSyncBytes: defaultLimits.maxSyncAssetBytes,
    });
    const id = assets.stage({ lease, asset: metadata, unavailable: 'not_exposed' });
    f.db.query('UPDATE runs SET generation=generation+1 WHERE id=?').run(lease.id);
    expect(assets.garbage()).toEqual([id]);
    expect(() => assets.reserve({ lease, id, bytes: 1 })).toThrow('lease lost');
    const next = { ...lease, generation: lease.generation + 1 };
    expect(() =>
      f.acquisition.commit({
        lease: next,
        page: page(metadata),
        definition: { ...fixture.definition, kinds: { item: { type: 'object' } } },
      }),
    ).toThrow('asset not captured');
    expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpoint).toBe(0);
  } finally {
    f.close();
  }
});

test('asset streams are scoped to the queued delivery owner', async () => {
  const f = await harness({
    step: async ({ assets }) => page(await assets.capture({ ...metadata, read: bytes })),
  });
  try {
    await f.engine.tick();
    expect(f.engine.api.deliveries(beta).deliveries).toEqual([]);
    const db = new Database(f.files.path);
    try {
      const { SqliteDeliveries } = await import('../src/repositories/delivery/sqlite');
      const deliveries = new SqliteDeliveries(db);
      const lease = deliveries.claim(leaseMs)!;
      const assets = new SqliteAssets({ db, maxBytes: 100, maxSyncBytes: 100 });
      expect(() => assets.read({ lease: { ...lease, ...beta }, asset: metadata })).toThrow(
        'lease lost',
      );
    } finally {
      db.close();
    }
  } finally {
    await f.close();
  }
});

test('a changed record retains only its own assets while unchanged sibling captures are deleted', async () => {
  let changed = false;
  let hold = false;
  const received: Deliverable[] = [];
  const f = await harness({
    step: async ({ assets }) => {
      const [left, right] = await Promise.all(
        ['left', 'right'].map((id) => assets.capture({ ...metadata, id, read: bytes })),
      );
      return {
        records: [
          { ...record(left!), id: 'left', data: { value: changed ? 2 : 1 } },
          { ...record(right!), id: 'right' },
        ],
        checkpoint: 1,
        complete: true,
      };
    },
    destination: {
      ...accepted,
      deliver: ({ deliverable }) => {
        received.push(deliverable);
        return Promise.resolve(
          hold ? { status: 'rejected', code: 'hold' } : { status: 'accepted' },
        );
      },
    },
  });
  try {
    await f.poll();
    changed = true;
    hold = true;
    await f.poll();
    expect(received).toHaveLength(2);
    expect(received[1]!.records.map((r) => r.id)).toEqual(['left']);
    expect(received[1]!.assets.map((a) => a.id)).toEqual(['left']);
    expect(f.ledger()).toEqual({ bytes: 10, count: 1 });
    expect(await readdir(`${f.files.path}.assets`)).toHaveLength(1);
  } finally {
    await f.close();
  }
});
