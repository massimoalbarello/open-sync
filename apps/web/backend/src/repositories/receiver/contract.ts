import type { AssetUpload } from '@context-use/open-sync/assets';
import type { Delivery } from '@context-use/open-sync/delivery';
import type { JsonObject } from '@context-use/open-sync/json';
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
  acceptAsset(
    input: ReceiverScope & AssetUpload & { sourceId: string; signal: AbortSignal },
  ): Promise<string>;
  asset(
    input: ReceiverScope & { id: string },
  ): Promise<{ name: string; mediaType: string; body: ReadableStream<Uint8Array> } | undefined>;
  records(
    input: ReceiverScope & { sourceId?: string; offset: number },
  ): Promise<{ records: ReceivedRecord[]; hasMore: boolean; pageSize: number }>;
  status(scope: ReceiverScope): Promise<ReceiverStatus>;
  setPaused(input: ReceiverScope & { paused: boolean }): Promise<void>;
  accept(input: ReceiverScope & { delivery: Delivery }): Promise<boolean>;
}
