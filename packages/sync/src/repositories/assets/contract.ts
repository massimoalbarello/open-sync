import type { AssetMetadata, AssetRef } from '../../models/asset';
import type { AcquisitionLease } from '../acquisition/contract';
import type { DeliveryLease } from '../delivery/contract';

export interface AssetRepository {
  stage(input: { lease: AcquisitionLease; asset: AssetMetadata; unavailable?: string }): string;
  captured(input: { lease: AcquisitionLease; id: string; size: number; sha256: string }): void;
  reserve(input: { lease: AcquisitionLease; id: string; bytes: number }): void;
  discarded(id: string): void;
  garbage(): string[];
  retained(id: string): boolean;
  read(input: { lease: DeliveryLease; asset: AssetRef }): string;
}
export interface AssetFiles {
  write(input: {
    id: string;
    body: ReadableStream<Uint8Array>;
    reserve(file: { id: string; bytes: number }): void;
    maxBytes: number;
    signal: AbortSignal;
  }): Promise<{ id: string; size: number; sha256: string }>;
  open(id: string): Promise<ReadableStream<Uint8Array>>;
  remove(id: string): Promise<void>;
  sweep(input: { retain(id: string): boolean }): Promise<void>;
}
