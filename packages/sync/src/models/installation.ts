import type { ConnectionRef, DefinitionRef } from './definition';
import type { Scope } from './identity';
import type { JsonObject, JsonValue } from './json';

export interface Installation {
  id: string;
  ownerId: string;
  sourceId: string;
  definition: DefinitionRef;
  connection?: ConnectionRef;
  config: JsonObject;
  destinationId: string;
  enabled: boolean;
  bindingEpoch: number;
  checkpoint: JsonValue;
  checkpointRevision: number;
  intervalMs: number;
  nextDueAt: number;
  status: string;
}
export interface CreateInstallation extends Scope {
  definition: DefinitionRef;
  connection?: ConnectionRef;
  config: JsonObject;
  destinationId: string;
  intervalMs?: number;
  enabled?: boolean;
}

export interface SyncRun {
  id: string;
  state: string;
  startedAt: number;
  completedAt: number | null;
  pages: number;
  checkpointRevision: number;
}
