import type { Schema } from '@cfworker/json-schema';
import type { SourceAssets } from './asset';
import type { Deliverable } from './delivery';
import type { JsonObject, JsonValue } from './json';

// biome-ignore lint/performance/noBarrelFile: Public source-authoring entry point exposes its failure contract.
export { SourceHttpError } from './source-http-error';

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
  actions: readonly string[];
  proxyPaths?: readonly string[];
  proxyPostPaths?: readonly string[];
}
/** JSON or text response from the provider, including non-success HTTP statuses. */
export interface ProviderResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: JsonValue;
}
export interface ProviderOperations {
  action(input: { id: string; input: JsonObject }): Promise<JsonValue>;
  /** Execute a declared file action and consume its temporary file through the owned Connector. */
  download?(input: {
    id: string;
    input: JsonObject;
    /** Top-level result field containing the file; omit when the action returns it directly. */
    fileField?: string;
  }): Promise<ReadableStream<Uint8Array>>;
  get(input: { path: string; query?: JsonObject }): Promise<ProviderResponse>;
  post(input: { path: string; body: JsonObject }): Promise<ProviderResponse>;
}
export interface SyncDefinition extends DefinitionRef {
  name?: string;
  description?: string;
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
  assets: SourceAssets;
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
