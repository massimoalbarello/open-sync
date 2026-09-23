import type { AssetMetadata, DeliveryAsset } from '@context-use/open-sync/assets';
import type { Deliverable } from '@context-use/open-sync/delivery';
import type { JsonObject } from '@context-use/open-sync/json';
import type { RecordContent, SyncRecord } from '@context-use/open-sync/record';
export interface ReceiverScope {
  actorId: string;
  ownerId: string;
}
export interface ReceiverStatus {
  paused: boolean;
  records: number;
  receipts: number;
}
export interface ReceivedRecord
  extends Pick<
    Extract<SyncRecord, { operation: 'upsert' }>,
    'preview' | 'createdAt' | 'updatedAt'
  > {
  syncId: string;
  kind: string;
  id: string;
  revision: number;
  data: JsonObject;
  content?: RecordContent;
  assets: ReceivedAsset[];
}
export interface ReceivedAsset extends Pick<AssetMetadata, 'createdAt' | 'updatedAt'> {
  id: string;
  syncId: string;
  name: string;
  mediaType: string;
  size: number;
}
export interface RecordIdentity {
  syncId: string;
  kind: string;
  id: string;
}
export interface ReceiverRepository {
  record(input: ReceiverScope & RecordIdentity): Promise<ReceivedRecord | undefined>;
  assetInfo(input: ReceiverScope & { id: string }): Promise<ReceivedAsset | undefined>;
  assets(input: ReceiverScope & { syncId?: string; offset: number }): Promise<{
    assets: ReceivedAsset[];
    hasMore: boolean;
    pageSize: number;
  }>;
  acceptAsset(
    input: ReceiverScope & {
      asset: DeliveryAsset;

      open(): Promise<ReadableStream<Uint8Array>>;
      syncId: string;
      signal: AbortSignal;
    },
  ): Promise<string>;
  asset(input: ReceiverScope & { id: string }): Promise<
    | {
        name: string;
        mediaType: string;
        size: number;
        open(range?: { start: number; end: number }): ReadableStream<Uint8Array>;
      }
    | undefined
  >;
  records(
    input: ReceiverScope & { syncId?: string; offset: number },
  ): Promise<{ records: ReceivedRecord[]; hasMore: boolean; pageSize: number }>;
  isPaused(scope: ReceiverScope): Promise<boolean>;
  status(scope: ReceiverScope): Promise<ReceiverStatus>;
  setPaused(input: ReceiverScope & { paused: boolean }): Promise<void>;
  accept(input: ReceiverScope & { delivery: Omit<Deliverable, 'openAsset'> }): Promise<boolean>;
}
