import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { assetsFirst } from '../src/delivery/assets-first';
import type { AssetRendering, AssetUpload, DeliveryAsset } from '../src/models/asset';
import { assetKey, assetPlaceholder } from '../src/models/asset';
import { resolveRecordAssets, validateAssetReferences } from '../src/models/asset-references';
import { SourceHttpError, type SyncRegistration } from '../src/models/definition';
import type { Delivery, DestinationType } from '../src/models/delivery';
import { createSyncRuntime } from '../src/runtime';
import { alpha, beta, storage } from './support';

const binaryBytes = [...Buffer.from('00ff0d0a', 'hex')];
const maxAttempts = 3;
const maxTicks = 5;
const assetByteLimit = 1024;
const rendering: AssetRendering = {
  structured: ({ outcome }) =>
    outcome.status === 'accepted' ? outcome.reference : { status: 'failed', code: outcome.code },
  markdown: ({ outcome }) =>
    outcome.status === 'accepted'
      ? `https://destination.example/files/${outcome.reference}`
      : 'Attachment unavailable',
};
function source(
  input: { read?(): Promise<ReadableStream<Uint8Array>>; version?: string } = {},
): SyncRegistration {
  return {
    definition: {
      id: 'assets.test',
      version: '1',
      artifactId: 'assets.test/1',
      configSchema: { type: 'object' },
      checkpointSchema: { type: 'integer' },
      initialCheckpoint: 0,
      kinds: { note: { type: 'object' } },
    },
    load: () => ({
      async *run(context) {
        const asset = await context.assets.capture({
          id: 'file',
          version: input.version ?? '1',
          name: 'file.bin',
          mediaType: 'application/octet-stream',
          read:
            input.read ?? (() => Promise.resolve(new Blob([new Uint8Array(binaryBytes)]).stream())),
        });
        yield {
          deliverable: {
            records: [
              {
                operation: 'upsert',
                kind: 'note',
                id: 'first',
                data: { file: assetPlaceholder('first'), body: '[file](open-sync-asset:first)' },
                assetRefs: { first: asset },
                markdownFields: ['body'],
              },
            ],
          },
          checkpoint: 1,
          complete: true,
        };
      },
    }),
  };
}
async function setup(input: {
  destination: DestinationType;
  registration?: SyncRegistration;
  attempts?: number;
  maxAssetBytes?: number;
  maxPendingAssetBytes?: number;
}) {
  const files = storage();
  const registration = input.registration ?? source();
  const options = {
    databasePath: files.path,
    definitions: [registration],
    destinationTypes: { target: input.destination },
    timing: { assetAttempts: input.attempts ?? maxAttempts, retryMs: 1 },
    limits: {
      maxAssetBytes: input.maxAssetBytes ?? assetByteLimit,
      ...(input.maxPendingAssetBytes ? { maxPendingAssetBytes: input.maxPendingAssetBytes } : {}),
    },
  };
  let engine = createSyncRuntime(options);
  const destination = engine.api.createDestination({ ...alpha, type: 'target', config: {} });
  const installation = await engine.api.createInstallation({
    ...alpha,
    definition: registration.definition,
    config: {},
    destinationId: destination.id,
  });
  return {
    files,
    installation,
    options,
    get engine() {
      return engine;
    },
    async tick() {
      const db = new Database(files.path);
      db.exec('UPDATE deliveries SET due_at=0');
      db.exec("UPDATE installations SET next_due_at=0 WHERE status!='succeeded'");
      db.close();
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
function separate(input: {
  upload(input: AssetUpload): Promise<import('../src/models/asset').AssetResult>;
  deliver(delivery: Delivery): Promise<import('../src/models/delivery').DeliveryResult>;
}): DestinationType {
  return {
    version: '1',
    configSchema: { type: 'object' },
    acceptsAssets: true,
    deliver: assetsFirst({
      rendering,
      upload: input.upload,
      deliver: ({ delivery }) => input.deliver(delivery),
    }),
  };
}

test.each([false, true])(
  'asset source timestamps remain immutable and survive delivery (unavailable: %s)',
  async (unavailable) => {
    let createdAt = '2020-01-01T01:00:00+01:00';
    const received: DeliveryAsset[] = [];
    const fixture = await setup({
      registration: {
        definition: source().definition,
        load: () => ({
          async *run({ assets }) {
            const metadata = {
              id: 'dated',
              version: '1',
              name: 'dated.txt',
              mediaType: 'text/plain',
              createdAt,
            };
            const asset = unavailable
              ? assets.unavailable({ ...metadata, code: 'source_unavailable' })
              : await assets.capture({
                  ...metadata,
                  read: () => Promise.resolve(new Blob(['file']).stream()),
                });
            yield { deliverable: { records: [], assets: [asset] }, checkpoint: 1, complete: true };
          },
        }),
      },
      destination: {
        version: '1',
        configSchema: { type: 'object' },
        acceptsAssets: true,
        deliver: ({ delivery }) => {
          received.push(...delivery.deliverable.assets!);
          return Promise.resolve({ status: 'accepted' });
        },
      },
    });
    try {
      await fixture.tick();
      await fixture.tick();
      expect(received[0]).toMatchObject({ createdAt: '2020-01-01T00:00:00.000Z' });
      expect(received[0]).not.toHaveProperty('updatedAt');
      await fixture.restart();
      createdAt = '2020-01-01T00:00:00.000Z';
      const resource = { ...alpha, id: fixture.installation.id };
      fixture.engine.api.queueRun(resource);
      await fixture.tick();
      await fixture.tick();
      expect(fixture.engine.api.installation(resource).status).toBe('succeeded');
      createdAt = '2020-01-02T00:00:00Z';
      fixture.engine.api.queueRun(resource);
      await fixture.tick();
      expect(fixture.engine.api.installation(resource).status).toBe('asset_version_conflict');
      createdAt = '2020-02-30T00:00:00Z';
      fixture.engine.api.queueRun(resource);
      await fixture.tick();
      expect(fixture.engine.api.installation(resource).status).toBe('invalid_input');
    } finally {
      await fixture.close();
    }
  },
);

test('asset acceptance and materialized record survive restart, preserving source hashes and releasing only queued bytes', async () => {
  let uploads = 0;
  const records: Delivery[] = [];
  const fixture = await setup({
    destination: separate({
      async upload(input) {
        uploads++;
        expect([...new Uint8Array(await new Response(await input.open()).arrayBuffer())]).toEqual(
          binaryBytes,
        );
        return { status: 'accepted', reference: '42' };
      },
      deliver: (delivery) => {
        records.push(delivery);
        return Promise.resolve(records.length === 1 ? { status: 'retry' } : { status: 'accepted' });
      },
    }),
  });
  try {
    await fixture.tick();
    await fixture.tick();
    expect(records).toHaveLength(1);
    const db = new Database(fixture.files.path);
    const logical = JSON.parse(
      db.query<{ body: string }, []>('SELECT body FROM deliveries').get()!.body,
    ) as Delivery;
    db.close();
    expect(logical.deliverable.records[0]).toMatchObject({
      data: { file: 'open-sync-asset:first' },
    });
    expect(records[0]!.deliverable.records[0]).toMatchObject({
      data: { file: '42', body: '[file](https://destination.example/files/42)\n' },
      contentHash: logical.deliverable.records[0]!.contentHash,
    });
    await fixture.restart();
    await fixture.tick();
    expect(uploads).toBe(1);
    expect(records[1]).toEqual(records[0]);
    expect(await readdir(`${fixture.files.path}.assets`)).toEqual([]);
    fixture.engine.api.queueRun({ ...alpha, id: fixture.installation.id });
    await fixture.tick();
    await fixture.tick();
    expect(records).toHaveLength(2);
  } finally {
    await fixture.close();
  }
});

test('lost asset response retries the same idempotency key and obtains the original assigned reference', async () => {
  const remote = new Map<string, string>();
  const keys: string[] = [];
  let delivered: Delivery | undefined;
  const fixture = await setup({
    destination: separate({
      upload: async (input) => {
        await new Response(await input.open()).arrayBuffer();
        keys.push(input.idempotencyKey);
        remote.set(input.idempotencyKey, remote.get(input.idempotencyKey) ?? 'remote-1');
        if (keys.length === 1) {
          throw new Error('Response lost');
        }
        return { status: 'accepted', reference: remote.get(input.idempotencyKey)! };
      },
      deliver: (delivery) => {
        delivered = delivery;
        return Promise.resolve({ status: 'accepted' });
      },
    }),
  });
  try {
    await fixture.tick();
    await fixture.tick();
    await fixture.restart();
    await fixture.tick();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(remote.size).toBe(1);
    expect(delivered?.deliverable.records[0]).toMatchObject({ data: { file: 'remote-1' } });
  } finally {
    await fixture.close();
  }
});

test('bounded upload failures become explicit record outcomes, including Markdown, after persisted retries', async () => {
  let calls = 0;
  let delivered: Delivery | undefined;
  const fixture = await setup({
    destination: separate({
      upload: () => {
        calls++;
        return Promise.resolve({ status: 'retry', code: 'remote_unavailable' });
      },
      deliver: (delivery) => {
        delivered = delivery;
        return Promise.resolve({ status: 'accepted' });
      },
    }),
  });
  try {
    await fixture.tick();
    await fixture.tick();
    await fixture.restart();
    await fixture.tick();
    await fixture.tick();
    expect(calls).toBe(maxAttempts);
    expect(delivered?.deliverable.records[0]).toMatchObject({
      data: {
        file: { status: 'failed', code: 'remote_unavailable' },
        body: 'Attachment unavailable\n',
      },
    });
    expect(fixture.engine.api.status(alpha).queue.pendingRecords).toBe(0);
  } finally {
    await fixture.close();
  }
});

test.each([
  { mode: 'fetch', expectedReads: maxAttempts, code: 'asset_fetch_failed' },
  { mode: 'oversized', expectedReads: 1, code: 'asset_too_large' },
  { mode: 'provider_oversized', expectedReads: 1, code: 'asset_too_large' },
  { mode: 'capacity', expectedReads: maxAttempts, code: 'asset_storage_full' },
])(
  '$mode capture failures never enqueue partial content or lose the record',
  async ({ mode, expectedReads, code }) => {
    let delivered: Delivery | undefined;
    let reads = 0;
    const fixture = await setup({
      maxAssetBytes: mode === 'oversized' ? 2 : assetByteLimit,
      ...(mode === 'capacity' ? { maxPendingAssetBytes: 2 } : {}),
      registration: source({
        read: () => {
          reads++;
          if (mode === 'provider_oversized') {
            return Promise.reject(new SourceHttpError({ status: 413 }));
          }
          return mode !== 'fetch'
            ? Promise.resolve(new Blob(['too large']).stream())
            : Promise.reject(new Error('Token must not leak'));
        },
      }),
      destination: separate({
        upload: () => {
          throw new Error('Unavailable assets must not be uploaded');
        },
        deliver: (delivery) => {
          delivered = delivery;
          return Promise.resolve({ status: 'accepted' });
        },
      }),
    });
    try {
      for (let tick = 0; tick < maxTicks; tick++) {
        await fixture.tick();
      }
      expect(reads).toBe(expectedReads);
      expect(delivered?.deliverable.records[0]).toMatchObject({
        data: {
          file: {
            status: 'failed',
            code,
          },
        },
      });
      expect(JSON.stringify(delivered)).not.toContain('Token must not leak');
    } finally {
      await fixture.close();
    }
  },
);

test('bundle adapters receive logical references and streams, with no requirement to return asset IDs', async () => {
  let captured: Delivery | undefined;
  const fixture = await setup({
    destination: {
      version: '1',
      configSchema: { type: 'object' },
      acceptsAssets: true,
      async deliver({ delivery, assets }) {
        captured = delivery;
        expect(
          await new Response(await assets!.open(delivery.deliverable.assets![0]!)).arrayBuffer(),
        ).toHaveProperty('byteLength', binaryBytes.length);
        await expect(assets!.open({ id: 'foreign', version: '1' })).rejects.toMatchObject({
          code: 'not_found',
        });
        return { status: 'accepted' };
      },
    },
  });
  try {
    await fixture.tick();
    await fixture.tick();
    expect(captured?.version).toBe(2);
    expect(captured?.deliverable.records[0]).toMatchObject({
      data: { file: 'open-sync-asset:first' },
    });
    expect(fixture.engine.api.status(beta).queue.pendingDeliveries).toBe(0);
  } finally {
    await fixture.close();
  }
});

test('placeholder protocol resolves repeated and distinct assets while preserving literal code and link formatting', () => {
  const refs = { a: { id: 'first', version: '1' }, b: { id: 'second', version: '1' } };
  const record = {
    operation: 'upsert' as const,
    kind: 'note',
    id: '1',
    eventId: 'event',
    revision: 1,
    contentHash: 'source',
    assetRefs: refs,
    content: {
      format: 'markdown' as const,
      body: '| File | Status |\n| --- | --- |\n| [first](open-sync-asset:a) | ~~pending~~ |\n\n- [x] Read the file',
    },
    markdownFields: ['body'],
    data: {
      files: ['open-sync-asset:b', 'open-sync-asset:a', 'open-sync-asset:a'],
      body: '[first][ref] ![second](open-sync-asset:b) `open-sync-asset:a`\n\n[ref]: open-sync-asset:a',
    },
  };
  validateAssetReferences(record);
  const resolved = resolveRecordAssets({
    record,
    assets: Object.values(refs).map((ref) => ({
      ...ref,
      name: ref.id,
      mediaType: 'text/plain',
      size: 1,
      sha256: 'hash',
    })),
    outcomes: new Map([
      [assetKey(refs.a), { status: 'accepted', reference: 'A' }],
      [assetKey(refs.b), { status: 'accepted', reference: 'B' }],
    ]),
    rendering,
  });
  expect(resolved).toMatchObject({ contentHash: 'source', data: { files: ['B', 'A', 'A'] } });
  expect(resolved.operation === 'upsert' && resolved.data.body).toContain('`open-sync-asset:a`');
  expect(resolved.operation === 'upsert' && resolved.content?.body).toMatch(/^\| File\s+\|/m);
  expect(resolved.operation === 'upsert' && resolved.content?.body).toContain(
    '[first](https://destination.example/files/A)',
  );
  expect(resolved.operation === 'upsert' && resolved.content?.body).toContain('~~pending~~');
  expect(resolved.operation === 'upsert' && resolved.content?.body).toContain(
    '* [x] Read the file',
  );
  expect(() => validateAssetReferences({ ...record, assetRefs: { a: refs.a } })).toThrow();
});

test.each([
  '[file][ref]\n\n> [ref]: open-sync-asset:a',
  '[file][ref]\n\n- [ref]: open-sync-asset:a',
  '[file][ref]\n\n[ref]: open-sync-asset:a\n[ref]: https://wrong.example/file',
])(
  'Markdown asset references follow nested definitions and first-definition precedence: %s',
  (body) => {
    const ref = { id: 'first', version: '1' };
    const record = {
      operation: 'upsert' as const,
      kind: 'note',
      id: '1',
      eventId: 'event',
      revision: 1,
      contentHash: 'source',
      assetRefs: { a: ref },
      markdownFields: ['body'],
      data: { body },
    };
    validateAssetReferences(record);
    for (const outcome of [
      { status: 'accepted' as const, reference: 'A' },
      { status: 'failed' as const, code: 'unavailable' },
    ]) {
      const resolved = resolveRecordAssets({
        record,
        assets: [{ ...ref, name: 'file', mediaType: 'text/plain', size: 1, sha256: 'hash' }],
        outcomes: new Map([[assetKey(ref), outcome]]),
        rendering,
      });
      expect(resolved.operation === 'upsert' && resolved.data.body).toContain(
        outcome.status === 'accepted'
          ? '[file](https://destination.example/files/A)'
          : 'Attachment unavailable',
      );
      expect(resolved.operation === 'upsert' && resolved.data.body).not.toContain(
        'open-sync-asset:',
      );
    }
  },
);

test('a failed acquisition retains completed captures for restart without advancing the checkpoint', async () => {
  let reads = 0;
  let failPage = true;
  const original = source({
    read: () => {
      reads++;
      return Promise.resolve(new Blob(['stable bytes']).stream());
    },
  });
  const registration: SyncRegistration = {
    ...original,
    load: async () => {
      const executable = await original.load();
      return {
        async *run(context) {
          for await (const page of executable.run(context)) {
            if (failPage) {
              throw new Error('Source interrupted after capture');
            }
            yield page;
          }
        },
      };
    },
  };
  const fixture = await setup({
    registration,
    destination: separate({
      upload: () => Promise.resolve({ status: 'accepted', reference: '42' }),
      deliver: () => Promise.resolve({ status: 'accepted' }),
    }),
  });
  try {
    await fixture.tick();
    expect(
      fixture.engine.api.installation({ ...alpha, id: fixture.installation.id }).checkpoint,
    ).toBe(0);
    expect(await readdir(`${fixture.files.path}.assets`)).toHaveLength(1);
    await fixture.restart();
    failPage = false;
    await fixture.tick();
    await fixture.tick();
    expect(reads).toBe(1);
    expect(fixture.engine.api.status(alpha).queue.pendingRecords).toBe(0);
  } finally {
    await fixture.close();
  }
});

test('a slow destination does not hold delivery to another owner and destination', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const otherDelivered = Promise.withResolvers<void>();
  const fixture = await setup({
    destination: {
      version: '1',
      configSchema: { type: 'object' },
      acceptsAssets: true,
      async deliver({ scope, assets, delivery }) {
        const bytes = await new Response(
          await assets!.open(delivery.deliverable.assets![0]!),
        ).text();
        expect(bytes.length).toBeGreaterThan(0);
        if (scope.ownerId === alpha.ownerId) {
          entered.resolve();
          await release.promise;
        } else {
          otherDelivered.resolve();
        }
        return { status: 'accepted' };
      },
    },
  });
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  try {
    await fixture.tick();
    const target = fixture.engine.api.createDestination({ ...beta, type: 'target', config: {} });
    await fixture.engine.api.createInstallation({
      ...beta,
      definition: source().definition,
      config: {},
      destinationId: target.id,
    });
    fixture.engine.start();
    first = fixture.tick();
    await entered.promise;
    second = fixture.tick();
    await otherDelivered.promise;
    expect(fixture.engine.api.status(alpha).queue.pendingRecords).toBe(1);
  } finally {
    release.resolve();
    await Promise.all([first, second]);
    await fixture.close();
  }
});
