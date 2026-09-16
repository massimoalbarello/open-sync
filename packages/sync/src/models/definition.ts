import type { Schema } from '@cfworker/json-schema';
import type { Deliverable } from './delivery';
import type { JsonObject, JsonValue } from './json';

export interface DefinitionRef {
  id: string;
  version: string;
  artifactId: string;
}
export interface ConnectionRef {
  id: string;
  service: string;
}
export interface ProviderRequirements {
  service: string;
  requiredScopes: readonly string[];
  actions: readonly string[];
  proxyPaths?: readonly string[];
  proxyPostPaths?: readonly string[];
}
export interface ProviderOperations {
  action(input: { id: string; input: JsonObject }): Promise<JsonValue>;
  get(input: { path: string; query?: JsonObject }): Promise<JsonValue>;
  post(input: { path: string; body: JsonObject }): Promise<JsonValue>;
}
export interface SyncDefinition extends DefinitionRef {
  configSchema: Schema;
  checkpointSchema: Schema;
  initialCheckpoint: JsonValue;
  kinds: Readonly<Record<string, Schema>>;
  provider?: ProviderRequirements;
}
export interface SyncPage {
  deliverable: Deliverable;
  checkpoint: JsonValue;
  complete: boolean;
}
export interface SyncContext {
  config: JsonObject;
  checkpoint: JsonValue;
  sourceId: string;
  signal: AbortSignal;
  provider: ProviderOperations;
  log(input: { message: string; fields?: JsonObject }): void;
}
export interface SyncExecutable {
  run(context: SyncContext): AsyncIterable<SyncPage>;
}
/** Trusted host code only. Loading uploaded code requires a separate isolated execution layer. */
export interface SyncRegistration {
  definition: SyncDefinition;
  load(): SyncExecutable | Promise<SyncExecutable>;
}
export function definitionKey(ref: DefinitionRef): string {
  return JSON.stringify([ref.id, ref.version, ref.artifactId]);
}
