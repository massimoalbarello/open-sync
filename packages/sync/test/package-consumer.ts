// Copied into an isolated consumer by the package check; imports must resolve from the tarball.

import { createOpenSync } from '@open-sync/core';
import type { SyncRegistration } from '@open-sync/core/definition';
import type { Delivery } from '@open-sync/core/delivery';

const definition: SyncRegistration = {
  definition: {
    id: 'package-test',
    version: '1',
    artifactId: 'package-test/1',
    configSchema: { type: 'object' },
    checkpointSchema: { type: 'integer' },
    initialCheckpoint: 0,
    kinds: { item: { type: 'object' } },
  },
  load: () => ({
    // biome-ignore lint/suspicious/useAwait: Trusted package-consumer fixture emits a single asynchronous page.
    async *run() {
      yield {
        checkpoint: 1,
        complete: true,
        deliverable: {
          records: [{ operation: 'upsert', kind: 'item', id: 'one', data: { value: 1 } }],
        },
      };
    },
  }),
};
const received: Delivery[] = [];
const scope = { actorId: 'consumer', ownerId: 'consumer' };
const sync = await createOpenSync({
  dataDirectory: './consumer-state',
  publicUrl: 'http://host/embedded',
  authorize: () => scope,
  canConfigureProviders: () => Promise.resolve(true),
  definitions: [definition],
  destinationTypes: {
    local: {
      version: '1',
      configSchema: { type: 'object' },
      create: () => ({
        deliver: ({ delivery }) => {
          received.push(delivery);
          return Promise.resolve({ status: 'accepted' });
        },
      }),
    },
  },
});
try {
  const destination = sync.api.createDestination({ ...scope, type: 'local', config: {} });
  await sync.api.createInstallation({
    ...scope,
    destinationId: destination.id,
    config: {},
    definition: definition.definition,
  });
  await sync.tick();
  await sync.tick();
  if (received.length !== 1 || sync.api.status(scope).queue.pendingRecords !== 0) {
    throw new Error('Independent consumer did not receive its record');
  }
  const catalog = await sync.fetch(new Request('http://host/embedded/providers'));
  if (
    !catalog.ok ||
    !((await catalog.json()) as { service: string }[]).some((item) => item.service === 'github')
  ) {
    throw new Error('Independent host cannot discover provider authentication through Open Sync');
  }
  console.log(
    'Installed Open Sync manages providers and delivers directly to an independent host.',
  );
} finally {
  await sync.close();
}
