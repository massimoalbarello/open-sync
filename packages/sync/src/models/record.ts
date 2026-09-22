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
      /** Source-defined structured representation, from metadata to the complete record. */
      data: JsonObject;
      content?: RecordContent;
      assetRefs?: Record<string, AssetRef>;
      markdownFields?: string[];
    })
  | { operation: 'delete'; kind: string; id: string };
