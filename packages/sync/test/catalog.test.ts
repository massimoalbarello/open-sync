import { expect, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { alpha, fixture, page, repositories, runtime } from './support';

test('public registration metadata excludes execution state and duplicate source names are rejected', async () => {
  const f = runtime();
  try {
    expect(() => createSyncRuntime({ ...f.options, definitions: [fixture, fixture] })).toThrow(
      'definition conflict',
    );
    expect(f.engine.api.destinationTypes(alpha)).toMatchObject([
      { type: 'local', setupSchema: { type: 'object', additionalProperties: false } },
    ]);
    const definition = f.engine.api.definitions(alpha)[0]!;
    expect(definition).not.toHaveProperty('initialCheckpoint');
    expect(definition).not.toHaveProperty('checkpointSchema');
    expect(definition).not.toHaveProperty('kinds');
  } finally {
    await f.close();
  }
});

test('poll stats paginate without losing older iterations when new polls arrive', () => {
  const f = repositories();
  const scope = { ...alpha, id: f.sync.id };
  const iterations = 22;
  const pageSize = 20;
  const leaseMs = 60_000;
  try {
    expect(f.catalog.polls(scope)).toEqual({ polls: [], nextCursor: null });
    const other = f.catalog.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination: { type: 'local', config: {} },
      initialCheckpoint: 0,
    });
    f.catalog.setEnabled({ ...alpha, id: other.id, enabled: false });
    for (let i = 0; i < iterations; i++) {
      f.catalog.runNow(scope);
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        definition: fixture.definition,
        page: { ...page, complete: true, records: i === iterations - 1 ? [] : page.records },
      });
    }
    const first = f.catalog.polls(scope);
    const polls = first.polls;
    expect(polls).toHaveLength(pageSize);
    expect(polls[0]).toMatchObject({ state: 'succeeded', recordsProcessed: 0, recordsQueued: 0 });
    expect(polls[1]).toMatchObject({ state: 'succeeded', recordsProcessed: 1, recordsQueued: 0 });
    expect(polls.every(({ completedAt }) => completedAt !== null)).toBe(true);
    f.catalog.setEnabled({ ...alpha, id: other.id, enabled: true });
    f.acquisition.commit({
      lease: f.acquisition.claim(leaseMs)!,
      definition: fixture.definition,
      page: { ...page, complete: true },
    });
    expect(f.catalog.polls({ ...alpha, id: other.id }).polls).toHaveLength(1);
    f.catalog.runNow(scope);
    f.acquisition.commit({
      lease: f.acquisition.claim(leaseMs)!,
      definition: fixture.definition,
      page: { ...page, complete: true },
    });
    const older = f.catalog.polls({ ...scope, before: first.nextCursor! });
    expect(older.polls).toHaveLength(iterations - pageSize);
    expect(older.nextCursor).toBeNull();
    expect(new Set([...polls, ...older.polls].map(({ id }) => id)).size).toBe(iterations);
    expect(older.polls.at(-1)).toMatchObject({ recordsProcessed: 1, recordsQueued: 1 });
  } finally {
    f.close();
  }
});
