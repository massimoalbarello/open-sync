import type { SyncDefinition, SyncPage } from '../../models/definition';
import type { Scope } from '../../models/identity';
import type { Installation } from '../../models/installation';

export interface RunLease extends Scope {
  id: string;
  installation: Installation;
  workerId: string;
  generation: number;
  checkpointRevision: number;
  failureCount: number;
}
export interface AcquisitionRepository {
  claim(leaseMs: number): RunLease | undefined;
  hasCapacity(): boolean;
  commit(input: { lease: RunLease; page: SyncPage; definition: SyncDefinition }): void;
  finish(input: { lease: RunLease; state: string; delay: number; failureCount?: number }): void;
}
