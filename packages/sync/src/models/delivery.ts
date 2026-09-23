import type { Schema } from '@cfworker/json-schema';
import type { AssetRef, DeliveryAsset } from './asset';
import type { Scope } from './identity';
import type { JsonObject } from './json';
import type { SyncRecord } from './record';

/** Source-authored record plus the monotonic revision used to reject stale replays. */
export type DeliveredRecord = SyncRecord & {
  revision: number;
};
/** One stable batch, replayed until the destination durably accepts all records and assets. */
export interface Deliverable {
  id: string;
  ownerId: string;
  syncId: string;
  definition: string;
  records: DeliveredRecord[];
  assets: DeliveryAsset[];
  /** Open a fresh stream during this attempt. Files may be deleted after acceptance. */
  openAsset(asset: AssetRef): Promise<ReadableStream<Uint8Array>>;
}
export type DeliveryResult =
  | { status: 'accepted' }
  | { status: 'retry'; retryAfterMs?: number; code?: string }
  | { status: 'rejected'; code: string };
export interface DestinationType {
  name?: string;
  description?: string;
  configSchema: Schema;
  /** User input is validated before preparation; only the resulting config is persisted. */
  setup?: {
    schema: Schema;
    prepare(input: { scope: Scope; input: JsonObject }): JsonObject | Promise<JsonObject>;
  };
  /** At-least-once delivery: accepted means durable acceptance of all records and assets.
   * Receive the original source representation and use deliverable.openAsset() for captured bytes.
   * The destination chooses whether to send the bundle or upload assets and resolve references first.
   */
  deliver(input: {
    scope: Scope;
    config: JsonObject;
    deliverable: Deliverable;
    signal: AbortSignal;
  }): Promise<DeliveryResult>;
}
export interface QueueStatus {
  pendingBytes: number;
  pendingRecords: number;
  pendingDeliveries: number;
  blockedDeliveries: number;
}
export interface PendingDelivery {
  id: string;
  syncId: string;
  state: 'pending' | 'leased' | 'blocked';
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
