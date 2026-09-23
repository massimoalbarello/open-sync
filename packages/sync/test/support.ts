import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/client';
import type { SyncRegistration } from '../src/models/definition';
import type { DestinationType } from '../src/models/delivery';
import type { Resource } from '../src/models/identity';
import { defaultLimits } from '../src/models/limits';
import { SqliteAcquisition } from '../src/repositories/acquisition/sqlite';
import { SqliteCatalog } from '../src/repositories/catalog/sqlite';
import { SqliteDeliveries } from '../src/repositories/delivery/sqlite';
import { readSync } from '../src/repositories/rows';
import { createSyncRuntime } from '../src/runtime';

export const alpha = { actorId: 'alice', ownerId: 'alpha' };
export const beta = { actorId: 'bob', ownerId: 'beta' };
export const fixture: SyncRegistration = {
  definition: {
    id: 'test',

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
    // A step is the execution boundary, even when this trusted fixture performs no I/O.
    // biome-ignore lint/suspicious/useAwait: Implement the asynchronous definition contract.
    async step({ checkpoint, config, signal }) {
      let cursor = checkpoint as number;
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
      return { deliverable: { records }, checkpoint: cursor, complete: cursor === config.count };
    },
  }),
};
export const accepted: DestinationType = {
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

  const destination = { type: 'local', config: {} };
  const sync = catalog.createSync({
    ...alpha,
    definition: fixture.definition.id,
    config: { count: 1 },
    destination,
    initialCheckpoint: 0,
  });
  return {
    files,
    db,
    catalog,
    acquisition,
    deliveries,
    sync,
    close: () => {
      db.close();
      files.close();
    },
  };
}
export async function configure(runtime: ReturnType<typeof createSyncRuntime>) {
  const destination = { type: 'local', input: {} };
  return await runtime.api.createSync({
    ...alpha,
    definition: fixture.definition.id,
    config: { count: 3 },
    destination,
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

/** Tests inspect private persistence directly when proving checkpoint atomicity. */
export function savedSync(input: { path: string; scope: Resource }) {
  const db = new Database(input.path, { readonly: true });
  try {
    return readSync({ db, scope: input.scope });
  } finally {
    db.close();
  }
}
