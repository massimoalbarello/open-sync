import { expect, spyOn, test } from 'bun:test';
import { createSyncController } from '../src/http/controller';
import type { SyncRegistration } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, beta, configure, fixture, page, repositories, storage } from './support';

test('a poll spans source steps and restart, counts records, and retains owner isolation', async () => {
  const files = storage();
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  const options = {
    databasePath: files.path,
    definitions: [fixture],
    timing: { sourceConcurrency: 1 },
    destinationTypes: { local: accepted },
  };
  let engine = createSyncRuntime(options);
  try {
    const installation = await configure(engine);
    const resource = { ...alpha, id: installation.id };
    now++;
    const other = await configure(engine);
    now++;
    await engine.tick();
    const first = engine.api.polls(resource).polls[0]!;
    expect(first).toMatchObject({
      state: 'syncing',
      recordsProcessed: 1,
      recordsChanged: 1,
      attemptCount: 1,
      completedAt: null,
    });
    expect(first.attempts[0]?.state).toBe('yielded');
    await engine.close();
    engine = createSyncRuntime(options);
    // The already-due second installation gets a turn before the first continues.
    await engine.tick();
    expect(engine.api.installation({ ...alpha, id: other.id }).checkpoint).toBe(1);
    const remainingSlices = 4;
    for (let i = 0; i < remainingSlices; i++) {
      now++;
      await engine.tick();
    }
    const completed = engine.api.polls(resource).polls[0]!;
    expect(completed).toMatchObject({
      id: first.id,
      state: 'succeeded',
      recordsProcessed: 3,
      recordsChanged: 3,
      attemptCount: 3,
    });
    expect(completed.completedAt).not.toBeNull();
    expect(completed.attempts.map((attempt) => attempt.state)).toEqual([
      'succeeded',
      'yielded',
      'yielded',
    ]);
    expect(() => engine.api.polls({ ...beta, id: installation.id })).toThrow('not found');
    engine.api.queueRun({ ...resource, backfill: true });
    const recordCount = 3;
    for (let i = 0; i < recordCount; i++) {
      now++;
      await engine.tick();
    }
    expect(engine.api.polls(resource).polls[0]).toMatchObject({
      recordsProcessed: 3,
      recordsChanged: 0,
      state: 'succeeded',
    });
    expect(engine.api.polls(resource).polls).toHaveLength(2);
    expect(engine.api.polls({ ...resource, offset: 1 }).polls).toHaveLength(1);
    const app = createSyncController({ api: engine.api, authorize: () => alpha });
    const response = await app.handle(
      new Request(`http://localhost/sync/installations/${installation.id}/polls`),
    );
    const ok = 200;
    expect(response.status).toBe(ok);
    expect((await response.json()).polls[0].recordsProcessed).toBe(recordCount);
  } finally {
    await engine.close();
    clock.mockRestore();
    files.close();
  }
});

test('each call commits one step and returns control to the scheduler', async () => {
  const files = storage();
  const timeoutMs = 800;
  let cleaned = false;
  const registration: SyncRegistration = {
    ...fixture,
    load: () => ({
      async step() {
        try {
          const firstPageDurationMs = 650;
          await Bun.sleep(firstPageDurationMs);
          return page;
        } finally {
          cleaned = true;
        }
      },
    }),
  };
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [registration],
    destinationTypes: { local: accepted },
    timing: { timeoutMs, leaseMs: 1600 },
  });
  try {
    const installation = await configure(engine);
    await engine.tick();
    expect(cleaned).toBe(true);
    expect(engine.api.installation({ ...alpha, id: installation.id }).checkpoint).toBe(1);
    expect(engine.api.polls({ ...alpha, id: installation.id }).polls[0]?.attempts[0]).toMatchObject(
      {
        state: 'yielded',
        recordsProcessed: 1,
      },
    );
    expect(
      engine.api.installation({ ...alpha, id: installation.id }).nextDueAt,
    ).toBeLessThanOrEqual(Date.now());
  } finally {
    await engine.close();
    files.close();
  }
});

test('a stalled attempt times out; pausing preserves its poll and reprocessing closes it', async () => {
  const files = storage();
  const registration: SyncRegistration = {
    ...fixture,
    load: () => ({
      async step({ signal, checkpoint }) {
        if (checkpoint === 0) {
          return page;
        }
        signal.throwIfAborted();
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        signal.throwIfAborted();
        return page;
      },
    }),
  };
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [registration],
    destinationTypes: { local: accepted },
    timing: { timeoutMs: 100 },
  });
  try {
    const installation = await configure(engine);
    const scope = { ...alpha, id: installation.id };
    // Commit the page before testing the stalled attempt, independent of filesystem latency.
    await engine.tick();
    await engine.tick();
    const timedOut = engine.api.polls(scope).polls[0]!;
    expect(timedOut).toMatchObject({ state: 'retrying', recordsProcessed: 1 });
    expect(timedOut.attempts[0]?.state).toBe('timed_out');
    await engine.api.setEnabled({ ...scope, enabled: false });
    expect(engine.api.polls(scope).polls[0]).toMatchObject({
      id: timedOut.id,
      state: 'paused',
      completedAt: null,
    });
    await engine.api.setEnabled({ ...scope, enabled: true });
    engine.api.queueRun({ ...scope, backfill: true });
    expect(engine.api.polls(scope).polls[0]).toMatchObject({ state: 'cancelled' });
    expect(engine.api.polls(scope).polls[0]?.completedAt).not.toBeNull();
  } finally {
    await engine.close();
    files.close();
  }
});

test.each([false, true])(
  'step output and scheduling roll back together (complete: %s)',
  (complete) => {
    const f = repositories();
    try {
      const leaseMs = 60_000;
      const lease = f.acquisition.claim(leaseMs)!;
      f.db.exec(
        "CREATE TRIGGER fail_finish BEFORE UPDATE OF state ON runs BEGIN SELECT RAISE(ABORT,'injected'); END",
      );
      expect(() =>
        f.acquisition.commit({
          lease,
          page: { ...page, complete },
          definition: fixture.definition,
        }),
      ).toThrow('injected');
      expect(
        f.catalog.polls({ ...alpha, id: f.installation.id, offset: 0 }).polls[0],
      ).toMatchObject({
        recordsProcessed: 0,
        recordsChanged: 0,
        completedAt: null,
      });
      expect(f.catalog.installation({ ...alpha, id: f.installation.id }).checkpoint).toBe(0);
      expect(f.deliveries.status(alpha).pendingRecords).toBe(0);
    } finally {
      f.close();
    }
  },
);

test('empty completion batches do not inflate record totals', () => {
  const f = repositories();
  try {
    const leaseMs = 60_000;
    const lease = f.acquisition.claim(leaseMs)!;
    f.acquisition.commit({ lease, page, definition: fixture.definition });
    f.acquisition.commit({
      lease: f.acquisition.claim(leaseMs)!,
      page: { ...page, deliverable: { records: [] }, complete: true },
      definition: fixture.definition,
    });
    const history = f.catalog.polls({ ...alpha, id: f.installation.id, offset: 0 });
    expect(history.polls[0]).toMatchObject({
      state: 'succeeded',
      recordsProcessed: 1,
      recordsChanged: 1,
    });
    expect(history.polls[0]?.attempts[0]).toMatchObject({ recordsProcessed: 0, recordsChanged: 0 });
  } finally {
    f.close();
  }
});
