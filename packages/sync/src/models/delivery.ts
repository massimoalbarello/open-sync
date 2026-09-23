import type { Schema } from '@cfworker/json-schema';
import type { DeliveryAsset, DestinationAssets } from './asset';
import type { Scope } from './identity';
import type { JsonObject } from './json';
import type { SyncRecord } from './record';

export type DeliveredRecord = SyncRecord & {
  eventId: string;
  revision: number;
  contentHash: string;
};
/** Original source records plus engine identities and captured asset descriptors. */
export interface Deliverable {
  records: DeliveredRecord[];
  assets?: DeliveryAsset[];
}
/** Stable queued envelope, retried until the destination durably accepts its whole deliverable. */
export interface Delivery {
  version: 1 | 2;
  id: string;
  ownerId: string;
  syncId: string;
  definition: string;
  deliverable: Deliverable;
}
export type DeliveryResult =
  | { status: 'accepted' }
  | { status: 'retry'; retryAfterMs?: number; code?: string }
  | { status: 'rejected'; code: string };
export interface DestinationType {
  name?: string;
  description?: string;
  configSchema: Schema;
  /** Declares that deliver consumes assets, either as a bundle or with assetsFirst. */
  acceptsAssets?: boolean;
  /** User input is validated before preparation; only the resulting config is persisted. */
  setup?: {
    schema: Schema;
    prepare(input: { scope: Scope; input: JsonObject }): JsonObject | Promise<JsonObject>;
  };
  /** At-least-once delivery: accepted means durable acceptance of all records and assets.
   * Receive the original source representation and use assets.open() for captured bytes.
   * The destination chooses whether to send the bundle or upload assets and resolve references first.
   */
  deliver(input: {
    scope: Scope;
    config: JsonObject;
    delivery: Delivery;
    signal: AbortSignal;
    assets?: DestinationAssets;
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
