import type { SyncRuntime } from '@open-sync/core';
import { sampleSync } from './definition';
export class SampleSyncService {
  constructor(private readonly sync: SyncRuntime['api']) {}
  async create(scope: { actorId: string; ownerId: string }) {
    const destination = this.sync.createDestination({ ...scope, type: 'local', config: {} });
    const count = 12;
    const pageSize = 3;
    return await this.sync.createInstallation({
      ...scope,
      destinationId: destination.id,
      config: { count, pageSize },
      definition: sampleSync.definition,
    });
  }
}
