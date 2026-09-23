import { fail } from './error';
import type { SourceTimestamps } from './metadata';

/** Identity is scoped to one owner and configured sync. A version must identify immutable content. */
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
  /** Capture for this step. A read failure fails the step; later steps capture again. */
  capture(input: AssetCapture): Promise<AssetRef>;
  /** Declare a known permanent source limitation without downloading or discarding the attachment. */
  unavailable(input: AssetMetadata & { code: string }): AssetRef;
}
export function assetKey(asset: AssetRef): string {
  return JSON.stringify([asset.id, asset.version]);
}

const prefix = 'open-sync-asset:';
const keyPattern = /^[A-Za-z0-9_-]+$/;
/** Create a record-local asset reference for an exact JSON value or a content link target. */
export function assetPlaceholder(key: string): string {
  if (!keyPattern.test(key)) {
    fail('invalid_asset_placeholder');
  }
  return `${prefix}${key}`;
}
/** Parse an exact placeholder; ordinary strings return undefined, malformed placeholders throw. */
export function assetPlaceholderKey(value: string): string | undefined {
  if (!value.startsWith(prefix)) {
    return;
  }
  const key = value.slice(prefix.length);
  assetPlaceholder(key);
  return key;
}

/** Resolve an exact placeholder through the record's declared references. Does not inspect content. */
export function resolveAssetReference(input: {
  value: string;
  assetRefs: Readonly<Record<string, AssetRef>>;
}): AssetRef | undefined {
  const key = assetPlaceholderKey(input.value);
  if (key === undefined) {
    return;
  }
  if (!Object.hasOwn(input.assetRefs, key)) {
    return fail('unknown_asset_reference');
  }
  return input.assetRefs[key];
}
