import type { Delivery } from '@open-sync/core/delivery';
import type { JsonObject } from '@open-sync/core/json';
export interface ReceiverScope {
  actorId: string;
  ownerId: string;
}
export interface ReceiverStatus {
  paused: boolean;
  records: number;
  receipts: number;
}
export interface ReceivedRecord {
  sourceId: string;
  kind: string;
  id: string;
  revision: number;
  data: JsonObject;
}
export interface ReceiverRepository {
  records(
    input: ReceiverScope & { sourceId?: string; offset: number },
  ): Promise<{ records: ReceivedRecord[]; hasMore: boolean; pageSize: number }>;
  status(scope: ReceiverScope): Promise<ReceiverStatus>;
  setPaused(input: ReceiverScope & { paused: boolean }): Promise<void>;
  accept(input: ReceiverScope & { delivery: Delivery }): Promise<boolean>;
}
