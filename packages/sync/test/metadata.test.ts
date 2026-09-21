import { expect, test } from 'bun:test';
import type { SyncRecord } from '../src/models/delivery';
import { canonicalJson } from '../src/models/json';
import { defaultLimits } from '../src/models/limits';
import { preparePage } from '../src/models/page';
import { alpha, fixture, page, repositories } from './support';

const leaseMs = 60_000;
const createdAt = '2020-01-01T00:00:00.000Z';
const updatedAt = '2020-01-02T00:00:00.000Z';

test.each([false, true])(
  'record metadata changes advance revisions while equivalent polls deduplicate (content: %s)',
  (withContent) => {
    const f = repositories();
    try {
      const lease = f.acquisition.claim(leaseMs)!;
      let revision = 0;
      let previousHash: string | undefined;
      const content = { format: 'markdown' as const, body: '# Note' };
      const original = { ...page.deliverable.records[0]!, ...(withContent ? { content } : {}) };
      for (const metadata of [
        {},
        { preview: 'First preview' },
        { preview: 'Changed preview' },
        { preview: 'Changed preview', createdAt },
        { preview: 'Changed preview', createdAt, updatedAt },
        {},
      ]) {
        const output = { ...page, deliverable: { records: [{ ...original, ...metadata }] } };
        f.acquisition.commit({ lease, page: output, definition: fixture.definition });
        const delivery = f.deliveries.claim(leaseMs)!;
        const record = delivery.delivery.deliverable.records[0]!;
        expect(record).toMatchObject({ ...metadata, revision: ++revision });
        expect(record.contentHash).not.toBe(previousHash);
        if (Object.keys(metadata).length === 0) {
          expect(record.contentHash).toBe(
            canonicalJson(withContent ? [original.data, content, {}, []] : original.data).sha256,
          );
        }
        previousHash = record.contentHash;
        f.deliveries.complete({ lease: delivery, result: { status: 'accepted' }, delay: 0 });
        // UTC normalization happens before hashing, including timezone and whitespace differences.
        const equivalent = {
          ...original,
          ...metadata,
          ...(metadata.createdAt ? { createdAt: '2020-01-01T01:00:00+01:00' } : {}),
          ...(metadata.preview ? { preview: `  ${metadata.preview.replace(' ', '\n')}  ` } : {}),
        };
        f.acquisition.commit({
          lease,
          page: { ...page, deliverable: { records: [equivalent] } },
          definition: fixture.definition,
        });
        expect(f.deliveries.status(alpha).pendingRecords).toBe(0);
      }
    } finally {
      f.close();
    }
  },
);

test('preview normalization keeps a bounded single line without splitting Unicode characters', () => {
  const maxCharacters = 200;
  const record = {
    ...page.deliverable.records[0]!,
    preview: ` \n${'🙂'.repeat(maxCharacters + 1)}\n`,
  };
  const prepared = preparePage({
    page: { ...page, deliverable: { records: [record] } },
    definition: fixture.definition,
    limits: defaultLimits,
  });
  expect(prepared.deliverable.records[0]).toHaveProperty('preview', '🙂'.repeat(maxCharacters));
  expect(record.preview).toContain('\n');
});

test.each([
  { preview: null },
  { preview: 1 },
  { createdAt: null },
  { createdAt: '2020-02-30T00:00:00Z' },
  { createdAt: '2020-01-01' },
  { updatedAt: '2020-01-01T00:00:00' },
  { updatedAt: 0 },
  { occurredAt: createdAt },
])('invalid metadata %j leaves the entire page and checkpoint uncommitted', (metadata) => {
  const f = repositories();
  try {
    const lease = f.acquisition.claim(leaseMs)!;
    const invalid = { ...page.deliverable.records[0]!, ...metadata } as unknown as SyncRecord;
    expect(() =>
      f.acquisition.commit({
        lease,
        page: {
          ...page,
          deliverable: { records: [{ ...page.deliverable.records[0]!, id: 'valid' }, invalid] },
        },
        definition: fixture.definition,
      }),
    ).toThrow('invalid page');
    expect(f.deliveries.status(alpha).pendingRecords).toBe(0);
    expect(f.db.query('SELECT * FROM records').all()).toEqual([]);
    expect(f.catalog.installation({ ...alpha, id: f.installation.id }).checkpoint).toBe(0);
  } finally {
    f.close();
  }
});
