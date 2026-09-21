import { openDatabase } from './db/client';
import { type Logger, safeLogger } from './execution/diagnostics';
import type { ProviderGateway } from './execution/provider';
import { Worker } from './execution/worker';
import type { SyncRegistration } from './models/definition';
import type { DestinationType } from './models/delivery';
import { fail } from './models/error';
import {
  defaultLimits,
  defaultTiming,
  positive,
  type QueueLimits,
  type Timing,
} from './models/limits';
import { Registry } from './models/registry';
import { SqliteAcquisition } from './repositories/acquisition/sqlite';
import { DirectoryAssets } from './repositories/assets/filesystem';
import { SqliteAssets } from './repositories/assets/sqlite';
import { SqliteCatalog } from './repositories/catalog/sqlite';
import { SqliteDeliveries } from './repositories/delivery/sqlite';
import { AcquisitionService } from './services/acquisition';
import { DeliveryService } from './services/delivery';
import { SyncManagement } from './services/management';

export interface SyncRuntimeOptions {
  databasePath: string;
  /** Private directory dedicated to queued asset bytes. */
  assetDirectory?: string;
  definitions: readonly SyncRegistration[];
  destinationTypes: Readonly<Record<string, DestinationType>>;
  connector?: ProviderGateway;
  limits?: Partial<QueueLimits>;
  timing?: Partial<Timing>;
  onEvent?: Logger;
}
/** Bun headless composition root. The host owns listeners, authentication and process lifecycle. */
export function createSyncRuntime(options: SyncRuntimeOptions) {
  const timing = { ...defaultTiming, ...options.timing };
  const limits = { ...defaultLimits, ...options.limits };
  for (const value of [...Object.values(timing), ...Object.values(limits)]) {
    positive(value);
  }
  if (timing.timeoutMs >= timing.leaseMs) {
    fail('timeout_must_be_shorter_than_lease');
  }
  const registry = new Registry({
    definitions: options.definitions,
    destinations: options.destinationTypes,
  });
  const db = openDatabase(options.databasePath);
  try {
    const catalog = new SqliteCatalog(db);
    for (const definition of registry.definitions()) {
      catalog.register(definition);
    }
    const deliveries = new SqliteDeliveries(db);
    const assets = new SqliteAssets({
      db,
      maxBytes: limits.maxPendingAssetBytes,
      maxDeliveryBytes: limits.maxPendingBytes,
      maxMaterializedBytes: limits.maxMaterializedBytes,
    });
    const files = new DirectoryAssets(options.assetDirectory ?? `${options.databasePath}.assets`);
    const log = safeLogger(options.onEvent);
    const worker = new Worker({
      acquisition: new AcquisitionService({
        repository: new SqliteAcquisition({ db, limits, historyLimit: timing.historyLimit }),
        registry,
        assets,
        files,
        maxAssetBytes: limits.maxAssetBytes,
        gateway: options.connector,
        timing,
        log,
      }),
      delivery: new DeliveryService({ repository: deliveries, registry, timing, assets, files }),
      timing,
      log,
      async cleanup() {
        const garbage = assets.garbage();
        if (!garbage) {
          return;
        }
        for (const id of garbage.remove) {
          await files.remove(id);
        }
        await files.sweep({ retain: garbage.retain, before: Date.now() - timing.leaseMs });
      },
    });
    const api = new SyncManagement({
      catalog,
      deliveries,
      registry,
      worker,
      gateway: options.connector,
      limits,
      timeoutMs: timing.timeoutMs,
    });
    let closing: Promise<void> | undefined;
    return {
      api,
      start: () => worker.start(),
      tick: () => worker.tick(),
      close: () => {
        closing ??= worker.close().finally(() => db.close());
        return closing;
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
export type SyncRuntime = ReturnType<typeof createSyncRuntime>;
