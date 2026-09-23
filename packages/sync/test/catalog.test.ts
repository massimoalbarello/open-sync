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

test('poll stats keep only the latest 20 iterations per sync, including empty polls', () => {
  const f = repositories();
  const scope = { ...alpha, id: f.sync.id };
  const iterations = 22;
  const retained = 20;
  const leaseMs = 60_000;
  try {
    expect(f.catalog.polls(scope)).toEqual([]);
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
    const polls = f.catalog.polls(scope);
    expect(polls).toHaveLength(retained);
    expect(polls[0]).toMatchObject({ state: 'succeeded', recordsProcessed: 0, recordsQueued: 0 });
    expect(polls[1]).toMatchObject({ state: 'succeeded', recordsProcessed: 1, recordsQueued: 0 });
    expect(polls.every(({ completedAt }) => completedAt !== null)).toBe(true);
    f.catalog.setEnabled({ ...alpha, id: other.id, enabled: true });
    f.acquisition.commit({
      lease: f.acquisition.claim(leaseMs)!,
      definition: fixture.definition,
      page: { ...page, complete: true },
    });
    expect(f.catalog.polls({ ...alpha, id: other.id })).toHaveLength(1);
    expect(f.catalog.polls(scope)).toEqual(polls);
  } finally {
    f.close();
  }
});
