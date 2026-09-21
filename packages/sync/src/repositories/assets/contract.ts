import type { AssetMetadata, AssetOutcome, AssetRef, DeliveryAsset } from '../../models/asset';
import type { Delivery } from '../../models/delivery';
import type { RunLease } from '../acquisition/contract';
import type { DeliveryLease } from '../delivery/contract';

export interface CapturedAsset {
  asset: DeliveryAsset;
  fileId: string | null;
  attempt: number;
  state: string;
}
export interface AssetRepository {
  capture(input: { lease: RunLease; asset: AssetMetadata }): CapturedAsset;
  captured(input: {
    lease: RunLease;
    asset: AssetMetadata;
    file: { id: string; size: number; sha256: string };
  }): void;
  captureFailed(input: {
    lease: RunLease;
    asset: AssetMetadata;
    code: string;
    terminal: boolean;
  }): void;
  /** Keep the asset pending without counting the latest capture against its retry limit. */
  captureDeferred(input: { lease: RunLease; asset: AssetMetadata; code: string }): void;
  availableBytes(): number;
  garbage(): { remove: string[]; retain: string[] } | undefined;
  read(input: { lease: DeliveryLease; asset: AssetRef }): CapturedAsset;
  receipt(input: { lease: DeliveryLease; asset: AssetRef }): {
    key: string;
    attempt: number;
    outcome?: AssetOutcome;
  };
  recordOutcome(input: { lease: DeliveryLease; asset: AssetRef; outcome: AssetOutcome }): void;
  materialize(input: { lease: DeliveryLease; build(): Delivery }): Delivery;
}
export interface AssetFiles {
  write(input: {
    body: ReadableStream<Uint8Array>;
    maxBytes: number;
    signal: AbortSignal;
  }): Promise<{ id: string; size: number; sha256: string }>;
  open(id: string): Promise<ReadableStream<Uint8Array>>;
  remove(id: string): Promise<void>;
  sweep(input: { retain: string[]; before: number }): Promise<void>;
}
