import { expect, test } from 'bun:test';
import type { Delivery } from '../src/models/delivery';
import type { SyncRecord } from '../src/models/record';
import { accepted, alpha, configure, fixture, runtime } from './support';

test('every record uses one hash shape, including opaque data resembling the old hash envelope', async () => {
  const base = { operation: 'upsert' as const, kind: 'item', id: 'one' };
  let record: SyncRecord = {
    ...base,
    data: { data: { value: 1 }, assetRefs: {}, markdownFields: [] },
  };
  const received: Delivery[] = [];
  const f = runtime({
    registration: {
      definition: { ...fixture.definition, kinds: { item: { type: 'object' } } },
      load: () => ({
        step: () =>
          Promise.resolve({ deliverable: { records: [record] }, checkpoint: 1, complete: true }),
      }),
    },
    destination: {
      ...accepted,
      deliver: ({ delivery }) => {
        received.push(delivery);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    const sync = await configure(f.engine);
    const run = async () => {
      f.engine.api.queueRun({ ...alpha, id: sync.id });
      await f.engine.tick();
      await f.engine.tick();
    };
    await run();
    record = { ...base, data: { value: 1 }, assetRefs: {} };
    await run();
    expect(received).toHaveLength(2);
    expect(received.map((delivery) => delivery.deliverable.records[0]!.revision)).toEqual([1, 2]);
    expect(received[1]!.deliverable.records[0]!.contentHash).not.toBe(
      received[0]!.deliverable.records[0]!.contentHash,
    );
    record = { data: { value: 1 }, ...base };
    await run();
    expect(received).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('an asset content identity change redelivers its otherwise unchanged record', async () => {
  let version = 'first-content';
  const received: Delivery[] = [];
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        step: ({ assets }) =>
          Promise.resolve({
            deliverable: {
              records: [
                {
                  operation: 'upsert',
                  kind: 'item',
                  id: 'one',
                  data: { value: 1 },
                  assetRefs: {
                    file: assets.unavailable({
                      id: 'attachment',
                      version,
                      name: 'attachment',
                      mediaType: 'application/octet-stream',
                      code: 'external_file',
                    }),
                  },
                },
              ],
            },
            checkpoint: 1,
            complete: true,
          }),
      }),
    },
    destination: {
      ...accepted,
      acceptsAssets: true,
      deliver: ({ delivery }) => {
        received.push(delivery);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    const sync = await configure(f.engine);
    const run = async () => {
      f.engine.api.queueRun({ ...alpha, id: sync.id });
      await f.engine.tick();
      await f.engine.tick();
    };
    await run();
    version = 'changed-content';
    await run();
    await run();
    expect(received).toHaveLength(2);
    expect(received[1]!.deliverable.records[0]).toMatchObject({
      revision: 2,
      data: { value: 1 },
      assetRefs: { file: { id: 'attachment', version } },
    });
    expect(received[1]!.deliverable.assets).toMatchObject([{ id: 'attachment', version }]);
  } finally {
    await f.close();
  }
});
