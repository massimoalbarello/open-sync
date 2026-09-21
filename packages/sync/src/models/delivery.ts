import type { Schema } from '@cfworker/json-schema';
import type { AssetRef, DeliveryAsset, DestinationAssets } from './asset';
import type { DefinitionRef } from './definition';
import type { Scope } from './identity';
import type { JsonObject } from './json';

/** Source-authored readable content; it need not duplicate or be derived from data. */
export interface RecordContent {
  format: 'markdown';
  body: string;
}

export type SyncRecord =
  | {
      operation: 'upsert';
      kind: string;
      id: string;
      /** Source-defined structured representation, from metadata to the complete record. */
      data: JsonObject;
      content?: RecordContent;
      assetRefs?: Record<string, AssetRef>;
      markdownFields?: string[];
    }
  | { operation: 'delete'; kind: string; id: string };
export interface Deliverable {
  records: readonly SyncRecord[];
  assets?: readonly AssetRef[];
}
export type DeliveredRecord = SyncRecord & {
  eventId: string;
  revision: number;
  contentHash: string;
};
export interface Delivery {
  version: 1 | 2;
  id: string;
  ownerId: string;
  sourceId: string;
  installationId: string;
  definition: DefinitionRef;
  deliverable: { records: DeliveredRecord[]; assets?: DeliveryAsset[] };
}
export type DeliveryResult =
  | { status: 'accepted' }
  | { status: 'retry'; retryAfterMs?: number; code?: string }
  | { status: 'rejected'; code: string };
export interface DestinationType {
  name?: string;
  description?: string;
  /** Pin endpoint/interpretation changes to a new version. Existing work is never rerouted. */
  version: string;
  configSchema: Schema;
  /** Declares that deliver consumes assets, either as a bundle or with assetsFirst. */
  acceptsAssets?: boolean;
  /** User input is validated before preparation; only the resulting config is persisted. */
  setup?: {
    schema: Schema;
    prepare(input: { scope: Scope; input: JsonObject }): JsonObject | Promise<JsonObject>;
  };
  /** Accepted means durable acceptance of the whole delivery. Receivers must tolerate retries. */
  deliver(input: {
    scope: Scope;
    config: JsonObject;
    delivery: Delivery;
    signal: AbortSignal;
    assets?: DestinationAssets;
  }): Promise<DeliveryResult>;
}
export interface Destination {
  id: string;
  ownerId: string;
  type: string;
  version: string;
  config: JsonObject;
}
export interface QueueStatus {
  pendingBytes: number;
  pendingRecords: number;
  pendingDeliveries: number;
  blockedDeliveries: number;
}
export interface PendingDelivery {
  id: string;
  installationId: string;
  destinationId: string;
  state: string;
  bytes: number;
  recordCount: number;
  attempt: number;
  nextAttemptAt: number;
  errorCode: string | null;
}

export interface DeliveryPage {
  deliveries: PendingDelivery[];
  hasMore: boolean;
  pageSize: number;
}
