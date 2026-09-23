import type { SyncDefinition, SyncStep } from '../../models/definition';
import type { Scope } from '../../models/identity';
import type { RunState, Sync } from '../../models/sync';

export interface RunLease extends Scope {
  id: string;
  sync: Sync;
  generation: number;
  force: boolean;
  failureCount: number;
}
export interface AcquisitionRepository {
  capacityReleased(): void;
  nextDue(): number | undefined;
  claim(leaseMs: number): RunLease | undefined;
  hasCapacity(lease?: RunLease): boolean;
  commit(input: { lease: RunLease; page: SyncStep; definition: SyncDefinition }): void;
  finish(input: {
    lease: RunLease;
    state: RunState;
    errorCode?: string;
    delay: number;
    failureCount?: number;
    pause?: boolean;
  }): void;
}
