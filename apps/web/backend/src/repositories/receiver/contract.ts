import type { Deliverable } from '@context-use/open-sync/delivery';

export interface ReceiverScope {
  actorId: string;
  ownerId: string;
}
export interface ReceivedDeliverable {
  deliverable: Omit<Deliverable, 'openAsset'>;
  receivedAt: number;
}
export interface ReceiverRepository {
  deliverables(input: { scope: ReceiverScope; syncId: string; before?: number }): Promise<{
    deliverables: {
      id: string;
      syncId: string;
      receivedAt: number;
      recordCount: number;
      assetCount: number;
    }[];
    nextCursor: number | null;
  }>;
  deliverable(input: {
    scope: ReceiverScope;
    syncId: string;
    id: string;
  }): Promise<ReceivedDeliverable | undefined>;
  asset(input: { scope: ReceiverScope; syncId: string; id: string; index: number }): Promise<
    | {
        name: string;
        mediaType: string;
        size: number;
        open(range?: { start: number; end: number }): ReadableStream<Uint8Array>;
      }
    | undefined
  >;
  accept(input: {
    scope: ReceiverScope;
    deliverable: Deliverable;
    signal: AbortSignal;
  }): Promise<void>;
}
