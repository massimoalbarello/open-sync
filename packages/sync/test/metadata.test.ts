import { expect, test } from 'bun:test';
import { defaultLimits } from '../src/models/limits';
import { preparePage } from '../src/models/page';
import type { SyncRecord } from '../src/models/record';
import { alpha, fixture, page, repositories } from './support';

const leaseMs = 60_000;
const createdAt = '2020-01-01T00:00:00.000Z';
const updatedAt = '2020-01-02T00:00:00.000Z';

test('equivalent timestamp and preview representations deduplicate before hashing', () => {
  const f = repositories();
  try {
    for (const metadata of [
      { preview: 'First preview', createdAt, updatedAt },
      { preview: '  First\npreview  ', createdAt: '2020-01-01T01:00:00+01:00', updatedAt },
    ]) {
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        page: { ...page, records: [{ ...page.records[0]!, ...metadata }] },
        definition: fixture.definition,
      });
    }
    const delivery = f.deliveries.claim(leaseMs)!;
    expect(delivery.delivery.records[0]).toMatchObject({
      preview: 'First preview',
      createdAt,
      updatedAt,
      revision: 1,
    });
    expect(f.deliveries.status(alpha).pendingRecords).toBe(1);
  } finally {
    f.close();
  }
});

test('preview normalization keeps a bounded single line without splitting Unicode characters', () => {
  const maxCharacters = 200;
  const record = {
    ...page.records[0]!,
    preview: ` \n${'🙂'.repeat(maxCharacters + 1)}\n`,
  };
  const prepared = preparePage({
    page: { ...page, records: [record] },
    definition: fixture.definition,
    limits: defaultLimits,
  });
  expect(prepared.records[0]).toHaveProperty('preview', '🙂'.repeat(maxCharacters));
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
    const invalid = { ...page.records[0]!, ...metadata } as unknown as SyncRecord;
    expect(() =>
      f.acquisition.commit({
        lease,
        page: {
          ...page,
          records: [{ ...page.records[0]!, id: 'valid' }, invalid],
        },
        definition: fixture.definition,
      }),
    ).toThrow('invalid page');
    expect(f.deliveries.status(alpha).pendingRecords).toBe(0);
    expect(f.db.query('SELECT * FROM record_state').all()).toEqual([]);
    expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpoint).toBe(0);
  } finally {
    f.close();
  }
});
