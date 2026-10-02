import type { SyncDefinition, SyncStep } from '../../models/definition';
import type { Scope } from '../../models/identity';
import type { Sync, SyncStatus } from '../../models/sync';

export interface AcquisitionLease extends Scope {
  sync: Sync;
  generation: number;
  force: boolean;
}
export interface AcquisitionRepository {
  poll(): void;
  capacityReleased(): void;
  claim(leaseMs: number): AcquisitionLease | undefined;
  hasCapacity(): boolean;
  commit(input: { lease: AcquisitionLease; page: SyncStep; definition: SyncDefinition }): void;
  finish(input: {
    lease: AcquisitionLease;
    state: Exclude<SyncStatus, 'running' | 'disabled'>;
    errorCode?: string;
    pause?: boolean;
  }): void;
}
