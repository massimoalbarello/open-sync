import { assetKey, assetPlaceholder } from './asset';
import type { SyncDefinition, SyncStep } from './definition';
import { fail } from './error';
import { canonicalJson } from './json';
import type { QueueLimits } from './limits';
import { normalizeRecordMetadata } from './metadata';
import type { SyncRecord } from './record';
import { identifier, validate } from './validation';

export function preparePage(input: {
  page: SyncStep;
  definition: SyncDefinition;
  limits: QueueLimits;
}): SyncStep {
  try {
    const json = canonicalJson(input.page);
    if (Buffer.byteLength(json.json) > input.limits.maxPageBytes) {
      fail('invalid_page');
    }
    const page = json.value as unknown as SyncStep;
    if (
      Object.keys(page).some((key) => !['deliverable', 'checkpoint', 'complete'].includes(key)) ||
      typeof page.complete !== 'boolean'
    ) {
      fail('invalid_page');
    }
    if (
      Object.keys(page.deliverable).some((key) => !['records', 'assets'].includes(key)) ||
      !Array.isArray(page.deliverable.records) ||
      page.deliverable.records.length > input.limits.maxPageRecords
    ) {
      fail('invalid_page');
    }
    validatePageAssets({ page, limits: input.limits });
    validate({ value: page.checkpoint, schema: input.definition.checkpointSchema });
    const identities = new Set<string>();
    for (const record of page.deliverable.records) {
      validateRecord({ record, definition: input.definition });
      const key = JSON.stringify([record.kind, record.id]);
      if (identities.has(key)) {
        fail('duplicate_record');
      }
      identities.add(key);
    }
    return page;
  } catch {
    return fail('invalid_page');
  }
}
function validateRecord(input: { record: SyncRecord; definition: SyncDefinition }): void {
  const { record, definition } = input;
  identifier(record.kind);
  identifier(record.id);
  if (!Object.hasOwn(definition.kinds, record.kind)) {
    fail('unknown_kind');
  }
  const fields =
    record.operation === 'upsert'
      ? [
          'operation',
          'kind',
          'id',
          'data',
          'content',
          'assetRefs',
          'preview',
          'createdAt',
          'updatedAt',
        ]
      : ['operation', 'kind', 'id'];
  if (Object.keys(record).some((key) => !fields.includes(key))) {
    fail('invalid_record');
  }
  if (record.operation === 'upsert') {
    if (!record.data || Array.isArray(record.data) || typeof record.data !== 'object') {
      fail('invalid_record');
    }
    if (
      record.content !== undefined &&
      (!record.content ||
        typeof record.content !== 'object' ||
        Array.isArray(record.content) ||
        record.content.format !== 'markdown' ||
        typeof record.content.body !== 'string' ||
        Object.keys(record.content).some((key) => !['format', 'body'].includes(key)))
    ) {
      fail('invalid_record_content');
    }
    validateAssetReferences(record);
    validate({ value: record.data, schema: definition.kinds[record.kind]! });
    Object.assign(record, normalizeRecordMetadata(record));
  } else if (record.operation !== 'delete') {
    fail('invalid_record');
  }
}

function validatePageAssets(input: { page: SyncStep; limits: QueueLimits }) {
  const assets = input.page.deliverable.assets ?? [];
  if (!Array.isArray(assets) || assets.length > input.limits.maxPageAssets) {
    fail('invalid_assets');
  }
  const keys = new Set<string>();
  for (const asset of assets) {
    identifier(asset.id);
    identifier(asset.version);
    if (
      Object.keys(asset).some((key) => !['id', 'version'].includes(key)) ||
      keys.has(assetKey(asset))
    ) {
      fail('invalid_asset');
    }
    keys.add(assetKey(asset));
  }
  for (const record of input.page.deliverable.records) {
    if (record.operation === 'upsert') {
      for (const ref of Object.values(record.assetRefs ?? {})) {
        keys.add(assetKey(ref));
      }
    }
  }
  if (keys.size > input.limits.maxPageAssets) {
    fail('invalid_assets');
  }
}

/** Validate declarations only. The engine does not interpret record data or content. */
function validateAssetReferences(record: SyncRecord): void {
  if (record.operation !== 'upsert') {
    return;
  }
  const refs = record.assetRefs === undefined ? {} : record.assetRefs;
  if (!refs || Array.isArray(refs) || typeof refs !== 'object') {
    fail('invalid_asset_references');
  }
  for (const [key, ref] of Object.entries(refs)) {
    assetPlaceholder(key);
    identifier(ref.id);
    identifier(ref.version);
    if (Object.keys(ref).some((field) => !['id', 'version'].includes(field))) {
      fail('invalid_asset_reference');
    }
  }
}
