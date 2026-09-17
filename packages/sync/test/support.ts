import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/client';
import type { SyncRegistration } from '../src/models/definition';
import type { DestinationType } from '../src/models/delivery';
import { defaultLimits } from '../src/models/limits';
import { SqliteAcquisition } from '../src/repositories/acquisition/sqlite';
import { SqliteCatalog } from '../src/repositories/catalog/sqlite';
import { SqliteDeliveries } from '../src/repositories/delivery/sqlite';
import { createSyncRuntime } from '../src/runtime';

export const alpha = { actorId: 'alice', ownerId: 'alpha' };
export const beta = { actorId: 'bob', ownerId: 'beta' };
export const fixture: SyncRegistration = {
  definition: {
    id: 'test',
    version: '1',
    artifactId: 'test/1',
    configSchema: {
      type: 'object',
      properties: { count: { type: 'integer', minimum: 1 } },
      required: ['count'],
      additionalProperties: false,
    },
    checkpointSchema: { type: 'integer', minimum: 0 },
    initialCheckpoint: 0,
    kinds: {
      item: {
        type: 'object',
        properties: { value: { type: 'integer' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
  },
  load: () => ({
    // Async iteration is the execution boundary, even when this trusted fixture performs no I/O.
    // biome-ignore lint/suspicious/useAwait: Implement the asynchronous definition contract.
    async *run({ checkpoint, config, signal }) {
      let cursor = checkpoint as number;
      do {
        signal.throwIfAborted();
        const records =
          cursor < Number(config.count)
            ? [
                {
                  operation: 'upsert' as const,
                  kind: 'item',
                  id: String(cursor),
                  data: { value: cursor },
                },
              ]
            : [];
        cursor = Math.min(cursor + 1, Number(config.count));
        yield { deliverable: { records }, checkpoint: cursor, complete: cursor === config.count };
      } while (cursor < Number(config.count));
    },
  }),
};
export const accepted: DestinationType = {
  version: '1',
  configSchema: { type: 'object', additionalProperties: false },
  deliver: () => Promise.resolve({ status: 'accepted' }),
};
export const page = {
  deliverable: {
    records: [{ operation: 'upsert' as const, kind: 'item', id: 'first', data: { value: 1 } }],
  },
  checkpoint: 1,
  complete: false,
};
export function storage() {
  const dir = mkdtempSync(join(tmpdir(), 'open-sync-test-'));
  return {
    dir,
    path: join(dir, 'sync.db'),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
export function repositories(input: { maxPendingRecords?: number; maxPendingBytes?: number } = {}) {
  const files = storage();
  const db = openDatabase(files.path);
  const catalog = new SqliteCatalog(db);
  const acquisition = new SqliteAcquisition({
    db,
    limits: { ...defaultLimits, ...input },
    historyLimit: 1,
  });
  const deliveries = new SqliteDeliveries(db);
  catalog.register(fixture.definition);
  const destination = catalog.createDestination({
    ...alpha,
    type: 'local',
    version: '1',
    config: {},
  });
  const installation = catalog.createInstallation({
    ...alpha,
    definition: fixture.definition,
    config: { count: 1 },
    destinationId: destination.id,
    initialCheckpoint: 0,
  });
  return {
    files,
    db,
    catalog,
    acquisition,
    deliveries,
    installation,
    close: () => {
      db.close();
      files.close();
    },
  };
}
export async function configure(runtime: ReturnType<typeof createSyncRuntime>) {
  const destination = runtime.api.createDestination({ ...alpha, type: 'local', config: {} });
  return await runtime.api.createInstallation({
    ...alpha,
    definition: fixture.definition,
    config: { count: 3 },
    destinationId: destination.id,
  });
}
const fixtureQueueCapacity = 100;
export function runtime(
  input: {
    registration?: SyncRegistration;
    destination?: DestinationType;
    maxPendingRecords?: number;
  } = {},
) {
  const files = storage();
  const options = {
    databasePath: files.path,
    definitions: [input.registration ?? fixture],
    destinationTypes: { local: input.destination ?? accepted },
    limits: { maxPendingRecords: input.maxPendingRecords ?? fixtureQueueCapacity },
    timing: { retryMs: 1 },
  };
  const engine = createSyncRuntime(options);
  return {
    files,
    options,
    engine,
    close: async () => {
      await engine.close();
      files.close();
    },
  };
}
