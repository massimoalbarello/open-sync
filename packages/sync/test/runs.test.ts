import { expect, spyOn, test } from 'bun:test';
import { createSyncController } from '../src/http/controller';
import type { SyncRegistration } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import {
  accepted,
  alpha,
  beta,
  configure,
  fixture,
  page,
  repositories,
  savedSync,
  storage,
} from './support';

test('a run spans source steps and restart, counts records, and retains owner isolation', async () => {
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
    const sync = await configure(engine);
    const resource = { ...alpha, id: sync.id };
    now++;
    const other = await configure(engine);
    now++;
    await engine.tick();
    const first = engine.api.runs(resource).runs[0]!;
    expect(first).toMatchObject({
      state: 'ready',
      recordsProcessed: 1,
      recordsQueued: 1,
      completedAt: null,
    });
    await engine.close();
    engine = createSyncRuntime(options);
    // The already-due second sync gets a turn before the first continues.
    await engine.tick();
    expect(savedSync({ path: files.path, scope: { ...alpha, id: other.id } }).checkpoint).toBe(1);
    const remainingSlices = 4;
    for (let i = 0; i < remainingSlices; i++) {
      now++;
      await engine.tick();
    }
    const completed = engine.api.runs(resource).runs[0]!;
    expect(completed).toMatchObject({
      id: first.id,
      state: 'succeeded',
      recordsProcessed: 3,
      recordsQueued: 3,
    });
    expect(completed.completedAt).not.toBeNull();
    expect(() => engine.api.runs({ ...beta, id: sync.id })).toThrow('not found');
    await engine.api.resync(resource);
    const recordCount = 3;
    for (let i = 0; i < recordCount; i++) {
      now++;
      await engine.tick();
    }
    expect(engine.api.runs(resource).runs[0]).toMatchObject({
      recordsProcessed: 3,
      recordsQueued: 3,
      state: 'succeeded',
    });
    expect(engine.api.runs(resource).runs).toHaveLength(2);
    expect(engine.api.runs({ ...resource, offset: 1 }).runs).toHaveLength(1);
    const app = createSyncController({ api: engine.api, authorize: () => alpha });
    const response = await app.handle(new Request(`http://localhost/sync/syncs/${sync.id}/runs`));
    const ok = 200;
    expect(response.status).toBe(ok);
    expect((await response.json()).runs[0].recordsProcessed).toBe(recordCount);
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
    const sync = await configure(engine);
    await engine.tick();
    expect(cleaned).toBe(true);
    expect(savedSync({ path: files.path, scope: { ...alpha, id: sync.id } }).checkpoint).toBe(1);
    expect(engine.api.runs({ ...alpha, id: sync.id }).runs[0]).toMatchObject({
      state: 'ready',
      recordsProcessed: 1,
    });
    expect(engine.api.sync({ ...alpha, id: sync.id }).nextDueAt).toBeLessThanOrEqual(Date.now());
  } finally {
    await engine.close();
    files.close();
  }
});

test('a stalled attempt times out; pausing preserves its run and resync closes it', async () => {
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
    const sync = await configure(engine);
    const scope = { ...alpha, id: sync.id };
    // Commit the page before testing the stalled attempt, independent of filesystem latency.
    await engine.tick();
    await engine.tick();
    const timedOut = engine.api.runs(scope).runs[0]!;
    expect(timedOut).toMatchObject({ state: 'retrying', recordsProcessed: 1 });
    expect(timedOut.errorCode).toBe('timed_out');
    await engine.api.setEnabled({ ...scope, enabled: false });
    expect(engine.api.runs(scope).runs[0]).toMatchObject({
      id: timedOut.id,
      state: 'paused',
      completedAt: null,
    });
    await engine.api.setEnabled({ ...scope, enabled: true });
    await engine.api.resync(scope);
    expect(engine.api.runs(scope).runs[0]).toMatchObject({ state: 'ready', mode: 'resync' });
    expect(engine.api.runs(scope).runs[1]).toMatchObject({ id: timedOut.id, state: 'cancelled' });
    expect(engine.api.runs(scope).runs[1]?.completedAt).not.toBeNull();
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
        "CREATE TRIGGER fail_finish BEFORE UPDATE OF state ON sync_runs BEGIN SELECT RAISE(ABORT,'injected'); END",
      );
      expect(() =>
        f.acquisition.commit({
          lease,
          page: { ...page, complete },
          definition: fixture.definition,
        }),
      ).toThrow('injected');
      expect(f.catalog.runs({ ...alpha, id: f.sync.id, offset: 0 }).runs[0]).toMatchObject({
        recordsProcessed: 0,
        recordsQueued: 0,
        completedAt: null,
      });
      expect(f.catalog.sync({ ...alpha, id: f.sync.id }).checkpoint).toBe(0);
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
      page: { ...page, records: [], complete: true },
      definition: fixture.definition,
    });
    const history = f.catalog.runs({ ...alpha, id: f.sync.id, offset: 0 });
    expect(history.runs[0]).toMatchObject({
      state: 'succeeded',
      recordsProcessed: 1,
      recordsQueued: 1,
    });
  } finally {
    f.close();
  }
});
