import { expect, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { isolatedCrontab, runRegisteredCron } from './cron-support';
import { accepted, alpha, beta, configure, fixture, runtime, storage } from './support';

const RECORD_COUNT = 3;
const POLL_INTERVAL_MS = 100;
const AFTER_INTERVAL_MS = 150;

test('one host trigger drains all due syncs and deliveries, coalesces overlap, and respects pauses', async () => {
  const files = storage();
  const received: string[] = [];
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [fixture],
    limits: { maxPendingRecords: 1 },
    destinationTypes: {
      local: {
        ...accepted,
        deliver({ deliverable }) {
          received.push(deliverable.id);
          return Promise.resolve({ status: 'accepted' });
        },
      },
    },
  });
  try {
    const syncs = await Promise.all(
      [alpha, beta].map(async (scope) => ({
        scope,
        sync: await engine.api.createSync({
          ...scope,
          definition: 'test',
          config: { count: RECORD_COUNT },
          destination: { type: 'local', input: {} },
          intervalMs: POLL_INTERVAL_MS,
        }),
      })),
    );
    const first = engine.runDue();
    expect(engine.runDue()).toBe(first);
    await first;
    expect(received).toHaveLength(RECORD_COUNT * syncs.length);
    for (const { scope, sync } of syncs) {
      expect(engine.api.status(scope).queue.pendingRecords).toBe(0);
      expect(engine.api.polls({ ...scope, id: sync.id }).polls).toHaveLength(1);
    }
    // A host may choose its own timer or external scheduler without starting background work.
    await Bun.sleep(AFTER_INTERVAL_MS);
    const [paused, active] = syncs;
    await engine.api.setEnabled({ ...paused!.scope, id: paused!.sync.id, enabled: false });
    expect(engine.api.polls({ ...active!.scope, id: active!.sync.id }).polls).toHaveLength(1);
    await engine.runDue();
    expect(engine.api.polls({ ...paused!.scope, id: paused!.sync.id }).polls).toHaveLength(1);
    expect(engine.api.polls({ ...active!.scope, id: active!.sync.id }).polls).toHaveLength(2);
  } finally {
    await engine.close();
    files.close();
  }
});

test('cron joins startup work and remains the only automatic polling trigger', async () => {
  await using table = await isolatedCrontab();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let steps = 0;
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        async step() {
          steps++;
          entered.resolve();
          await release.promise;
          return { records: [], checkpoint: 0, complete: true };
        },
      }),
    },
  });
  try {
    await f.engine.api.createSync({
      ...alpha,
      definition: 'test',
      config: { count: 1 },
      destination: { type: 'local', input: {} },
      intervalMs: POLL_INTERVAL_MS,
    });
    await f.engine.start({ crontabExecutable: table.executable });
    await entered.promise;
    const running = f.engine.runDue();
    expect(f.engine.runDue()).toBe(running);
    release.resolve();
    await running;
    expect(steps).toBe(1);
    await Bun.sleep(AFTER_INTERVAL_MS);
    expect(steps).toBe(1);
    await runRegisteredCron(table.table);
    expect(steps).toBe(2);
  } finally {
    release.resolve();
    await f.close();
  }
});

test('shutdown interrupts a host trigger waiting for due work', async () => {
  const entered = Promise.withResolvers<void>();
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        async step({ signal }) {
          entered.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
          throw new Error('unreachable');
        },
      }),
    },
  });
  try {
    await configure(f.engine);
    const running = f.engine.runDue();
    await entered.promise;
    await f.engine.close();
    await running;
  } finally {
    await f.close();
  }
});
