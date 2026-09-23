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
  bindingEpoch: number;
  checkpoint: JsonValue;
  checkpointRevision: number;
  intervalMs: number;
  nextDueAt: number;
  status: string;
}
export interface CreateSync extends Scope {
  definition: string;
  connection?: ConnectionRef;
  config: JsonObject;
  destination: { type: string; input: JsonObject };
  intervalMs?: number;
  enabled?: boolean;
}

export interface SyncAttempt {
  id: string;
  state: string;
  startedAt: number;
  completedAt: number | null;
  recordsProcessed: number;
  recordsChanged: number;
}

export interface SyncPoll {
  id: string;
  state: string;
  startedAt: number;
  completedAt: number | null;
  recordsProcessed: number;
  recordsChanged: number;
  attemptCount: number;
  attempts: SyncAttempt[];
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
  status: string;
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
  };
}
