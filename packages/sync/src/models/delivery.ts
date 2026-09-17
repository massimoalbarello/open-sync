import type { Schema } from '@cfworker/json-schema';
import type { DefinitionRef } from './definition';
import type { Scope } from './identity';
import type { JsonObject } from './json';

export type SyncRecord =
  | { operation: 'upsert'; kind: string; id: string; data: JsonObject }
  | { operation: 'delete'; kind: string; id: string };
export interface Deliverable {
  records: readonly SyncRecord[];
}
export type DeliveredRecord = SyncRecord & {
  eventId: string;
  revision: number;
  contentHash: string;
};
export interface Delivery {
  version: 1;
  id: string;
  ownerId: string;
  sourceId: string;
  installationId: string;
  definition: DefinitionRef;
  deliverable: { records: DeliveredRecord[] };
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
  /** Accepted means durable acceptance of the whole delivery. Receivers must tolerate retries. */
  deliver(input: {
    scope: Scope;
    config: JsonObject;
    delivery: Delivery;
    signal: AbortSignal;
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
