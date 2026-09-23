import { expect, test } from 'bun:test';
import type { Deliverable } from '@context-use/open-sync/delivery';
import { localDestination } from '../src/destinations/local/definition';

const scope = { actorId: 'alice', ownerId: 'alice' };
test('local destination passes the original deliverable and awaits durable acceptance', async () => {
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
        data: { file: 'open-sync-asset:file' },
        assetRefs: { file: { id: 'file', version: '1' } },
      },
    ],
    assets: [
      { id: 'file', version: '1', name: 'file', mediaType: 'text/plain', size: 4, sha256: 'hash' },
    ],
    openAsset: () => Promise.resolve(new Blob(['file']).stream()),
  };
  const signal = new AbortController().signal;
  let fail = true;
  const destination = localDestination({
    async accept(input) {
      expect(input).toEqual({ scope, deliverable, signal });
      expect(input.deliverable).toBe(deliverable);
      expect(
        await new Response(await input.deliverable.openAsset(deliverable.assets[0]!)).text(),
      ).toBe('file');
      if (fail) {
        throw new Error('commit failed');
      }
    },
  });
  const context = { scope, config: {}, deliverable, signal };
  await expect(destination.deliver(context)).rejects.toThrow('commit failed');
  fail = false;
  expect(await destination.deliver(context)).toEqual({ status: 'accepted' });
  await expect(
    destination.deliver({ ...context, signal: AbortSignal.abort(new Error('cancelled')) }),
  ).rejects.toThrow('cancelled');
});
