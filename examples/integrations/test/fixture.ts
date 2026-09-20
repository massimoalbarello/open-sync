import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderOperations, SyncRegistration } from '@context-use/open-sync/definition';
import type { Delivery } from '@context-use/open-sync/delivery';
import { createSyncRuntime } from '@context-use/open-sync/engine';

export const owner = { actorId: 'alice', ownerId: 'alice' };
export const unused = () => Promise.reject(new Error('Unexpected provider operation'));

export async function fixture(input: {
  registration: SyncRegistration;
  provider: ProviderOperations;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'example-sync-'));
  const deliveries: Delivery[] = [];
  const options = {
    databasePath: join(directory, 'sync.db'),
    definitions: [input.registration],
    timing: { maxPages: 1 },
    connector: { bind: () => Promise.resolve(input.provider) },
    destinationTypes: {
      test: {
        version: '1',
        configSchema: { type: 'object' as const },
        deliver: ({ delivery }: { delivery: Delivery }) => {
          deliveries.push(delivery);
          return Promise.resolve({ status: 'accepted' as const });
        },
      },
    },
  };
  let engine = createSyncRuntime(options);
  const destination = engine.api.createDestination({ ...owner, type: 'test', config: {} });
  const installation = await engine.api.createInstallation({
    ...owner,
    definition: input.registration.definition,
    connection: { id: 'connection', service: input.registration.definition.provider!.service },
    config: {},
    destinationId: destination.id,
  });
  const resource = { ...owner, id: installation.id };
  return {
    get engine() {
      return engine;
    },
    get saved() {
      return engine.api.installation(resource);
    },
    get records() {
      return deliveries.flatMap((delivery) => delivery.deliverable.records);
    },
    queue() {
      engine.api.queueRun(resource);
    },
    async finish() {
      const maxTicks = 30;
      for (let tick = 0; tick < maxTicks; tick++) {
        await engine.tick();
        if (engine.api.installation(resource).status === 'execution_failed') {
          throw new Error('Example acquisition failed');
        }
        if (
          engine.api.installation(resource).status === 'succeeded' &&
          !engine.api.status(owner).queue.pendingRecords
        ) {
          return;
        }
      }
      throw new Error('Example did not finish');
    },
    async restart() {
      await engine.close();
      engine = createSyncRuntime(options);
    },
    async close() {
      await engine.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
