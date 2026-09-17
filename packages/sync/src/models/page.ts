import type { SyncDefinition, SyncPage } from './definition';
import type { SyncRecord } from './delivery';
import { fail } from './error';
import { canonicalJson } from './json';
import type { QueueLimits } from './limits';
import { identifier, validate } from './validation';

export function preparePage(input: {
  page: SyncPage;
  definition: SyncDefinition;
  limits: QueueLimits;
}): SyncPage {
  try {
    const json = canonicalJson(input.page);
    if (Buffer.byteLength(json.json) > input.limits.maxPageBytes) {
      fail('invalid_page');
    }
    const page = json.value as unknown as SyncPage;
    if (
      Object.keys(page).some((key) => !['deliverable', 'checkpoint', 'complete'].includes(key)) ||
      typeof page.complete !== 'boolean'
    ) {
      fail('invalid_page');
    }
    if (
      Object.keys(page.deliverable).some((key) => key !== 'records') ||
      !Array.isArray(page.deliverable.records) ||
      page.deliverable.records.length > input.limits.maxPageRecords
    ) {
      fail('invalid_page');
    }
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
      ? ['operation', 'kind', 'id', 'data']
      : ['operation', 'kind', 'id'];
  if (Object.keys(record).some((key) => !fields.includes(key))) {
    fail('invalid_record');
  }
  if (record.operation === 'upsert') {
    if (!record.data || Array.isArray(record.data) || typeof record.data !== 'object') {
      fail('invalid_record');
    }
    validate({ value: record.data, schema: definition.kinds[record.kind]! });
  } else if (record.operation !== 'delete') {
    fail('invalid_record');
  }
}
