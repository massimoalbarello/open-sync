import { expect, spyOn, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { isolatedScheduler, runRegisteredCron } from './cron-support';
import { accepted, alpha, beta, configure, fixture, runtime, storage } from './support';

const RECORD_COUNT = 3;
const IDLE_OBSERVATION_MS = 150;

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
    // Every host trigger polls again, without waiting for a per-sync deadline.
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
  await using table = await isolatedScheduler();
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
    });
    await f.engine.start();
    await entered.promise;
    const running = f.engine.runDue();
    expect(f.engine.runDue()).toBe(running);
    release.resolve();
    await running;
    expect(steps).toBe(1);
    await Bun.sleep(IDLE_OBSERVATION_MS);
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

test('manual wake-ups leave completed syncs idle and overlapping cron triggers share one poll', async () => {
  await using table = await isolatedScheduler();
  const blocked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const calls: number[] = [];
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        async step({ config }) {
          calls.push(Number(config.count));
          if (config.count === 2) {
            blocked.resolve();
            await release.promise;
          }
          return { records: [], checkpoint: 0, complete: true };
        },
      }),
    },
  });
  const create = (count: number) =>
    f.engine.api.createSync({
      ...alpha,
      definition: 'test',
      config: { count },
      destination: { type: 'local', input: {} },
    });
  try {
    const first = await create(1);
    await f.engine.runDue();
    await f.engine.start();
    await create(2);
    await blocked.promise;
    expect(calls).toEqual([1, 2]);
    const cron = f.engine.runDue();
    // Starting a cron round during a manual drain still includes the previously completed sync.
    // Wait for its committed poll while the other sync remains in flight.
    await until(
      () =>
        f.engine.api.polls({ ...alpha, id: first.id }).polls.length === 2 &&
        f.engine.api.sync({ ...alpha, id: first.id }).status === 'succeeded',
    );
    expect(f.engine.runDue()).toBe(cron);
    release.resolve();
    await cron;
    expect(calls).toEqual([1, 2, 1]);
    const afterManualPolls = 3;
    f.engine.api.runNow({ ...alpha, id: first.id });
    await until(
      () =>
        f.engine.api.polls({ ...alpha, id: first.id }).polls.length === afterManualPolls &&
        f.engine.api.sync({ ...alpha, id: first.id }).status === 'succeeded',
    );
    expect(calls).toEqual([1, 2, 1, 1]);
    await runRegisteredCron(table.table);
    expect(calls.filter((count) => count === 2)).toHaveLength(2);
  } finally {
    release.resolve();
    await f.close();
  }
});

async function until(check: () => boolean) {
  const timeoutMs = 5_000;
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('Sync did not reach the expected state');
    }
    await Bun.sleep(1);
  }
}

test('each cron round polls healthy syncs without bypassing source retry backoff', async () => {
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  const calls: number[] = [];
  let failing = true;
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        step({ config }) {
          calls.push(Number(config.count));
          if (config.count === 2 && failing) {
            return Promise.reject(new Error('temporary failure'));
          }
          return Promise.resolve({ records: [], checkpoint: 0, complete: true });
        },
      }),
    },
  });
  try {
    const syncs = await Promise.all(
      [1, 2].map((count) =>
        f.engine.api.createSync({
          ...alpha,
          definition: 'test',
          config: { count },
          destination: { type: 'local', input: {} },
        }),
      ),
    );
    await f.engine.runDue();
    await f.engine.runDue();
    expect(calls.filter((count) => count === 1)).toHaveLength(2);
    expect(calls.filter((count) => count === 2)).toHaveLength(1);
    const scope = { ...alpha, id: syncs[1]!.id };
    expect(f.engine.api.sync(scope).retryAt).toBe(now + f.options.timing.retryMs);
    now += f.options.timing.retryMs;
    failing = false;
    await f.engine.runDue();
    expect(calls.filter((count) => count === 2)).toHaveLength(2);
    expect(f.engine.api.sync(scope)).toMatchObject({ status: 'succeeded', retryAt: null });
  } finally {
    await f.close();
    clock.mockRestore();
  }
});
