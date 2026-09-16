import type { SyncDefinition } from '../../models/definition';
import type { Destination } from '../../models/delivery';
import type { Resource, Scope } from '../../models/identity';
import type { CreateInstallation, Installation } from '../../models/installation';
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
  setEnabled(input: Resource & { enabled: boolean }): Installation;
  queue(input: Resource & { checkpoint?: JsonValue }): void;
}
