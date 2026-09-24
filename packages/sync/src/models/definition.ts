import type { Schema } from '@cfworker/json-schema';
import type { SourceAssets } from './asset';
import type { JsonObject, JsonValue } from './json';
import type { SyncRecord } from './record';

// biome-ignore lint/performance/noBarrelFile: Public source-authoring entry point exposes its failure contract.
export { SourceHttpError } from './source-http-error';

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
export interface SyncDefinition {
  /** Host-defined registration name, shared by configured syncs using this implementation. */
  id: string;
  name?: string;
  description?: string;
  configSchema: Schema;
  checkpointSchema: Schema;
  initialCheckpoint: JsonValue;
  kinds: Readonly<Record<string, Schema>>;
  provider?: ProviderRequirements;
}
/** One complete source-defined unit: fetch its records and assets before returning.
 * The engine commits the output with its resume position; checkpoints do not carry unfinished records.
 */
export interface SyncStep {
  records: readonly SyncRecord[];
  /** Source-owned resume state, committed atomically with this page's records and outbox.
   * Include any cross-iteration update boundary as well as the current page position.
   */
  checkpoint: JsonValue;
  /** False continues this iteration immediately; true schedules the next poll.
   * Completion retains the returned checkpoint; the source clears any exhausted page cursor.
   */
  complete: boolean;
}
export interface SyncContext {
  config: JsonObject;
  checkpoint: JsonValue;
  /** Identity of this configured sync, also supplied to the destination. */
  syncId: string;
  signal: AbortSignal;
  provider: ProviderOperations;
  assets: SourceAssets;
}
export interface SyncExecutable {
  step(context: SyncContext): Promise<SyncStep>;
}
/** Trusted host code only. Loading uploaded code requires a separate isolated execution layer. */
export interface SyncRegistration {
  definition: SyncDefinition;
  load(): SyncExecutable | Promise<SyncExecutable>;
}
