import { expect, test } from 'bun:test';
import { alpha, beta, fixture, page, repositories } from './support';

const leaseMs = 60_000;
const changedRecords = 3;
const committedPages = 4;

test('a page rolls back records, outbox and checkpoint if the final write fails', () => {
  const f = repositories();
  try {
    const lease = f.acquisition.claim(leaseMs)!;
    f.db.exec(
      "CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF checkpoint ON syncs BEGIN SELECT RAISE(ABORT,'injected'); END;",
    );
    expect(() => f.acquisition.commit({ lease, page, definition: fixture.definition })).toThrow(
      'injected',
    );
    expect(f.db.query('SELECT * FROM records').all()).toEqual([]);
    expect(f.deliveries.status(alpha).pendingRecords).toBe(0);
    expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpointRevision).toBe(0);
    f.db.exec('DROP TRIGGER fail_checkpoint');
    f.acquisition.commit({ lease, page, definition: fixture.definition });
    expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpoint).toBe(1);
  } finally {
    f.close();
  }
});

test('queue capacity counts blocked and leased work and rejects whole pages atomically', () => {
  const f = repositories({ maxPendingRecords: 1 });
  try {
    const lease = f.acquisition.claim(leaseMs)!;
    f.acquisition.commit({ lease, page, definition: fixture.definition });
    const delivery = f.deliveries.claim(leaseMs)!;
    f.deliveries.complete({
      lease: delivery,
      result: { status: 'rejected', code: 'receiver_schema' },
      delay: 0,
    });
    expect(f.acquisition.hasCapacity()).toBe(false);
    const next = {
      ...page,
      records: [{ ...page.records[0]!, id: 'second' }],
      checkpoint: 2,
    };
    expect(() =>
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        page: next,
        definition: fixture.definition,
      }),
    ).toThrow('waiting for capacity');
    expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpoint).toBe(1);
    expect(f.db.query('SELECT * FROM records').all()).toHaveLength(1);
    f.deliveries.retry({ ...alpha, id: delivery.delivery.id });
    const retried = f.deliveries.claim(leaseMs)!;
    expect(retried.delivery).toEqual(delivery.delivery);
    expect(() =>
      f.deliveries.complete({ lease: delivery, result: { status: 'accepted' }, delay: 0 }),
    ).toThrow('lease lost');
    f.deliveries.complete({ lease: retried, result: { status: 'accepted' }, delay: 0 });
    expect(f.acquisition.hasCapacity()).toBe(true);
  } finally {
    f.close();
  }
});

test('serialized envelope byte budget is enforced before advancing progress', () => {
  const f = repositories({ maxPendingBytes: 1 });
  try {
    const lease = f.acquisition.claim(leaseMs)!;
    expect(() => f.acquisition.commit({ lease, page, definition: fixture.definition })).toThrow(
      'page exceeds queue capacity',
    );
    expect(f.db.query('SELECT * FROM records').all()).toEqual([]);
    expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpoint).toBe(0);
  } finally {
    f.close();
  }
});

test('binding changes, stale generations and stale checkpoint revisions cannot commit', () => {
  const f = repositories();
  try {
    const lease = f.acquisition.claim(leaseMs)!;
    expect(() =>
      f.acquisition.commit({
        lease: { ...lease, generation: lease.generation + 1 },
        page,
        definition: fixture.definition,
      }),
    ).toThrow('lease lost');
    const other = f.catalog.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination: f.sync.destination,
      initialCheckpoint: 0,
    });
    expect(() =>
      f.acquisition.commit({
        lease: { ...lease, sync: other },
        page,
        definition: fixture.definition,
      }),
    ).toThrow('lease lost');
    expect(() =>
      f.acquisition.commit({
        lease: { ...lease, checkpointRevision: -1 },
        page,
        definition: fixture.definition,
      }),
    ).toThrow('checkpoint conflict');
    const stale = { ...lease };
    f.acquisition.commit({ lease, page, definition: fixture.definition });
    expect(() =>
      f.acquisition.commit({ lease: stale, page, definition: fixture.definition }),
    ).toThrow('lease lost');
    f.catalog.setEnabled({ ...alpha, id: f.sync.id, enabled: false });
    f.catalog.setEnabled({ ...alpha, id: f.sync.id, enabled: true });
    expect(() => f.acquisition.commit({ lease, page, definition: fixture.definition })).toThrow(
      'lease lost',
    );
  } finally {
    f.close();
  }
});

test('hashes suppress repeats and tombstones retain monotonic revisions', () => {
  const f = repositories();
  try {
    for (const output of [
      page,
      page,
      {
        ...page,
        records: [{ operation: 'delete' as const, kind: 'item', id: 'first' }],
      },
      page,
    ]) {
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        page: output,
        definition: fixture.definition,
      });
    }
    expect(f.deliveries.status(alpha).pendingRecords).toBe(changedRecords);
    const stored = f.db.query<{ revision: number }, []>('SELECT revision FROM records').get();
    expect(stored?.revision).toBe(changedRecords);
    expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpointRevision).toBe(committedPages);
  } finally {
    f.close();
  }
});

test('owner filtering applies to reads, mutations and queued payloads', () => {
  const f = repositories();
  try {
    expect(f.catalog.syncs(beta)).toEqual([]);
    expect(() => f.catalog.sync({ ...beta, id: f.sync.id })).toThrow('not found');
    expect(() => f.catalog.setEnabled({ ...beta, id: f.sync.id, enabled: false })).toThrow(
      'not found',
    );
    const lease = f.acquisition.claim(leaseMs)!;
    f.acquisition.commit({ lease, page, definition: fixture.definition });
    const delivery = f.deliveries.claim(leaseMs)!;
    expect(delivery.delivery.ownerId).toBe(alpha.ownerId);
    expect(f.deliveries.pending({ ...beta, offset: 0 }).deliveries).toEqual([]);
    expect(() => f.deliveries.retry({ ...beta, id: delivery.delivery.id })).toThrow('not found');
  } finally {
    f.close();
  }
});
