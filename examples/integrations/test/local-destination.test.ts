import { expect, test } from 'bun:test';
import { assetPlaceholder } from '@context-use/open-sync/assets';
import type { Deliverable } from '@context-use/open-sync/delivery';
import { localDestination } from '../src/destinations/local/definition';

const scope = { actorId: 'alice', ownerId: 'alice' };
test('partial uploads retry before record acceptance without changing the original deliverable', async () => {
  const uploaded: string[] = [];
  const received: Omit<Deliverable, 'openAsset'>[] = [];
  let fail = true;
  const destination = localDestination({
    isPaused: () => Promise.resolve(false),
    accept: ({ delivery }) => {
      received.push(delivery);
      return Promise.resolve(true);
    },
    async acceptAsset({ asset, open }) {
      uploaded.push(asset.id);
      expect(await new Response(await open()).text()).toBe(asset.id);
      if (fail && asset.id === 'second') {
        throw new Error('upload failed');
      }
      return `remote-${asset.id}`;
    },
  });
  const deliverable: Deliverable = {
    id: 'batch',
    ownerId: scope.ownerId,
    syncId: 'sync',
    definition: 'source',
    records: [
      {
        operation: 'upsert',
        id: 'record',
        kind: 'item',
        revision: 1,
        data: { first: assetPlaceholder('first'), second: assetPlaceholder('second') },
        assetRefs: { first: { id: 'first', version: '1' }, second: { id: 'second', version: '1' } },
      },
    ],
    assets: ['first', 'second'].map((id) => ({
      id,
      version: '1',
      name: id,
      mediaType: 'text/plain',
      size: id.length,
      sha256: new Bun.CryptoHasher('sha256').update(id).digest('hex'),
    })),
    openAsset: (asset) => Promise.resolve(new Blob([asset.id]).stream()),
  };
  const context = { scope, config: {}, deliverable, signal: new AbortController().signal };
  await expect(destination.deliver(context)).rejects.toThrow('upload failed');
  expect(received).toEqual([]);
  fail = false;
  expect(await destination.deliver(context)).toEqual({ status: 'accepted' });
  expect(uploaded).toEqual(['first', 'second', 'first', 'second']);
  expect(received[0]!.records[0]).toMatchObject({
    data: { first: 'remote-first', second: 'remote-second' },
  });
  expect(deliverable.records[0]).toMatchObject({
    data: { first: assetPlaceholder('first'), second: assetPlaceholder('second') },
  });
  expect(received[0]).not.toHaveProperty('openAsset');
});
