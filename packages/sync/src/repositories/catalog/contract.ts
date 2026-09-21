import type { ConnectionRef, SyncDefinition } from '../../models/definition';
import type { Destination } from '../../models/delivery';
import type { Resource, Scope } from '../../models/identity';
import type {
  CreateInstallation,
  Installation,
  SyncPoll,
  SyncRun,
} from '../../models/installation';
import type { JsonObject, JsonValue } from '../../models/json';

export interface CatalogRepository {
  register(definition: SyncDefinition): void;
  createDestination(
    input: Scope & { type: string; version: string; config: JsonObject },
  ): Destination;
  destinations(scope: Scope): Destination[];
  createInstallation(input: CreateInstallation & { initialCheckpoint: JsonValue }): Installation;
  installation(input: Resource): Installation;
  installations(scope: Scope): Installation[];
  runs(input: Resource & { offset: number }): {
    runs: SyncRun[];
    hasMore: boolean;
    pageSize: number;
  };
  polls(input: Resource & { offset: number }): {
    polls: SyncPoll[];
    hasMore: boolean;
    pageSize: number;
  };
  connectInstallation(input: Resource & { connection: ConnectionRef }): Installation;
  setEnabled(input: Resource & { enabled: boolean }): Installation;
  queue(input: Resource & { checkpoint?: JsonValue }): void;
}
