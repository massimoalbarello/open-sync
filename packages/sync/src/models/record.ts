import type { AssetRef } from './asset';
import type { JsonObject } from './json';
import type { RecordMetadata } from './metadata';

/** Source-authored readable content; it need not duplicate or be derived from data. */
export interface RecordContent {
  format: 'markdown';
  body: string;
}

export type SyncRecord =
  | (RecordMetadata & {
      operation: 'upsert';
      kind: string;
      id: string;
      /** Source-defined JSON. The engine validates its schema but does not interpret its values. */
      data: JsonObject;
      content?: RecordContent;
      /** Maps record-local placeholder keys to captured immutable assets. References need not appear in data/content. */
      assetRefs?: Record<string, AssetRef>;
    })
  | { operation: 'delete'; kind: string; id: string };
