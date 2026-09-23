import { expect, test } from 'bun:test';
import type { SyncRecord } from '../src/models/record';
import { writeRecord } from '../src/repositories/acquisition/records';
import { page, repositories } from './support';

test.each([
  { data: { value: 2 } },
  { content: { format: 'markdown' as const, body: '# New content' } },
  { preview: 'New preview' },
  { createdAt: '2020-01-01T00:00:00.000Z' },
  { updatedAt: '2020-01-02T00:00:00.000Z' },
  { assetRefs: { file: { id: 'attachment', version: '2' } } },
] as const)(
  '%j changes and removals advance revisions; repeated records deduplicate',
  (changed) => {
    const f = repositories();
    const save = (record: SyncRecord) =>
      writeRecord({ db: f.db, sync: f.sync, record, assets: [], force: false });
    try {
      const original = page.records[0]!;
      const updated = { ...original, ...changed };
      expect(save(original)?.revision).toBe(1);
      expect(save(updated)).toEqual({ ...updated, revision: 2 });
      expect(save(updated)).toBeUndefined();
      const finalRevision = 3;
      expect(save(original)).toEqual({ ...original, revision: finalRevision });
    } finally {
      f.close();
    }
  },
);

test('opaque data cannot collide with the hash envelope and absent references normalize consistently', () => {
  const f = repositories();
  const save = (record: SyncRecord) =>
    writeRecord({ db: f.db, sync: f.sync, record, assets: [], force: false });
  try {
    const original = page.records[0]!;
    save({ ...original, data: { data: original.data, assetRefs: {}, markdownFields: [] } });
    expect(save({ ...original, assetRefs: {} })?.revision).toBe(2);
    expect(
      save({ data: original.data, id: original.id, kind: original.kind, operation: 'upsert' }),
    ).toBeUndefined();
  } finally {
    f.close();
  }
});
