import type { ConnectionRef } from './definition';
import type { Scope } from './identity';
import type { JsonObject, JsonValue } from './json';

export interface Sync {
  id: string;
  ownerId: string;
  definition: string;
  connection?: ConnectionRef;
  config: JsonObject;
  destination: { type: string; config: JsonObject };
  enabled: boolean;
  checkpoint: JsonValue;
  intervalMs: number;
  nextDueAt: number;
  status: SyncStatus;
  errorCode: string | null;
}
export interface CreateSync extends Scope {
  definition: string;
  connection?: ConnectionRef;
  config: JsonObject;
  destination: { type: string; input: JsonObject };
  intervalMs?: number;
  enabled?: boolean;
}

export type SyncStatus =
  | 'ready'
  | 'running'
  | 'retrying'
  | 'waiting_for_capacity'
  | 'disabled'
  | 'succeeded'
  | 'interrupted';

/** One scan through complete=true, including retries. Counts cover committed pages, not delivery acceptance. */
export interface SyncPoll {
  id: number;
  startedAt: number;
  completedAt: number | null;
  state: SyncStatus;
  errorCode: string | null;
  recordsProcessed: number;
  recordsQueued: number;
}
/** Host-visible status; configuration, checkpoints and execution fencing remain private. */
export interface SyncSummary {
  id: string;
  definition: string;
  destinationType: string;
  connection?: ConnectionRef;
  enabled: boolean;
  intervalMs: number;
  nextDueAt: number;
  status: SyncStatus;
  errorCode: string | null;
}
export function summarizeSync(sync: Sync): SyncSummary {
  return {
    id: sync.id,
    definition: sync.definition,
    destinationType: sync.destination.type,
    connection: sync.connection,
    enabled: sync.enabled,
    intervalMs: sync.intervalMs,
    nextDueAt: sync.nextDueAt,
    status: sync.status,
    errorCode: sync.errorCode,
  };
}
