import type { Delivery, DeliveryResult } from './delivery';
import { fail } from './error';
import type { JsonValue } from './json';
import type { SourceTimestamps } from './metadata';

/** Identity is scoped to one owner and source. A version must identify immutable content. */
export interface AssetRef {
  id: string;
  version: string;
}
export interface AssetMetadata extends AssetRef, SourceTimestamps {
  name: string;
  mediaType: string;
}
export type DeliveryAsset = AssetMetadata &
  ({ size: number; sha256: string } | { unavailable: string });
export interface AssetCapture extends AssetMetadata {
  /** Called only during acquisition. Credentials and temporary URLs never enter the queue. */
  read(): Promise<ReadableStream<Uint8Array>>;
}
export interface SourceAssets {
  /** Retries failed reads across acquisition runs; returns a reference after success or exhaustion. */
  capture(input: AssetCapture): Promise<AssetRef>;
  /** Declare a known permanent source limitation without downloading or discarding the attachment. */
  unavailable(input: AssetMetadata & { code: string }): AssetRef;
}
export type AssetOutcome =
  | { status: 'accepted'; reference: string }
  | { status: 'failed'; code: string };
export type AssetResult =
  | { status: 'accepted'; reference: string }
  | Exclude<DeliveryResult, { status: 'accepted' }>;
export interface AssetUpload {
  asset: DeliveryAsset;
  idempotencyKey: string;
  open(): Promise<ReadableStream<Uint8Array>>;
}
/** Bound to the current delivery. No storage paths, source capabilities or credentials are exposed. */
export interface DestinationAssets {
  open(asset: AssetRef): Promise<ReadableStream<Uint8Array>>;
  transfer(input: {
    asset: AssetRef;
    upload(input: AssetUpload): Promise<AssetResult>;
  }): Promise<AssetOutcome | Exclude<DeliveryResult, { status: 'accepted' }>>;
  /** Freeze the destination representation before its first send, including across restarts. */
  materialize(build: () => Delivery): Delivery;
}
export interface AssetRendering {
  structured(input: { asset: DeliveryAsset; outcome: AssetOutcome }): JsonValue;
  /** Return a destination URL for success, or plain explanatory text for failure. */
  markdown(input: { asset: DeliveryAsset; outcome: AssetOutcome }): string;
}
export function assetKey(asset: AssetRef): string {
  return JSON.stringify([asset.id, asset.version]);
}

const prefix = 'open-sync-asset:';
const keyPattern = /^[A-Za-z0-9_-]+$/;
export function assetPlaceholder(key: string): string {
  if (!keyPattern.test(key)) {
    fail('invalid_asset_placeholder');
  }
  return `${prefix}${key}`;
}
export function assetPlaceholderKey(value: string): string | undefined {
  if (!value.startsWith(prefix)) {
    return;
  }
  const key = value.slice(prefix.length);
  assetPlaceholder(key);
  return key;
}
