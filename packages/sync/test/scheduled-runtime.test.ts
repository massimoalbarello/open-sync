import { expect, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, configure, fixture, runtime, storage } from './support';

const RECORD_COUNT = 3;
const AFTER_INTERVAL_MS = 150;

test('external scheduling drains pages and delivery, coalesces runs, and installs no polling timer', async () => {
  const files = storage();
  const received: string[] = [];
  const scheduled: (number | undefined)[] = [];
  const errors: unknown[] = [];
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
    const sync = await engine.api.createSync({
      ...alpha,
      definition: 'test',
      config: { count: RECORD_COUNT },
      destination: { type: 'local', input: {} },
      intervalMs: 100,
    });
    engine.start({
      scheduleNext: (at) => {
        scheduled.push(at);
        return Promise.resolve();
      },
      onError: (error) => errors.push(error),
    });
    const first = engine.runDue();
    expect(engine.runDue()).toBe(first);
    await first;
    expect(received).toHaveLength(RECORD_COUNT);
    expect(engine.api.status(alpha).queue.pendingRecords).toBe(0);
    expect(scheduled.at(-1)).toBe(engine.api.sync({ ...alpha, id: sync.id }).nextDueAt);
    await Bun.sleep(AFTER_INTERVAL_MS);
    expect(engine.api.polls({ ...alpha, id: sync.id }).polls).toHaveLength(1);
    await engine.runDue();
    expect(engine.api.polls({ ...alpha, id: sync.id }).polls).toHaveLength(2);
    await engine.api.setEnabled({ ...alpha, id: sync.id, enabled: false });
    await engine.runDue();
    expect(scheduled.at(-1)).toBeUndefined();
    expect(errors).toEqual([]);
  } finally {
    await engine.close();
    files.close();
  }
});

test('delivery retries determine the next cron before the next source poll', async () => {
  const retryMs = 60_000;
  const scheduled: (number | undefined)[] = [];
  const f = runtime({
    destination: {
      ...accepted,
      deliver: () => Promise.resolve({ status: 'retry', retryAfterMs: retryMs }),
    },
  });
  try {
    const sync = await configure(f.engine);
    f.engine.start({
      scheduleNext: (at) => {
        scheduled.push(at);
        return Promise.resolve();
      },
      onError: (error) => {
        throw error;
      },
    });
    await f.engine.runDue();
    const deliveries = f.engine.api.deliveries({ ...alpha, syncId: sync.id }).deliveries;
    expect(scheduled.at(-1)).toBe(
      deliveries.find((delivery) => delivery.attempt === 1)!.nextAttemptAt,
    );
    expect(scheduled.at(-1)!).toBeLessThan(f.engine.api.sync({ ...alpha, id: sync.id }).nextDueAt);
  } finally {
    await f.close();
  }
});

test('shutdown interrupts an external run and does not register more work after close', async () => {
  const entered = Promise.withResolvers<void>();
  const scheduled: (number | undefined)[] = [];
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
    f.engine.start({
      scheduleNext: (at) => {
        scheduled.push(at);
        return Promise.resolve();
      },
      onError: () => {},
    });
    const running = f.engine.runDue();
    await entered.promise;
    await f.engine.close();
    await running;
    expect(scheduled).toEqual([]);
  } finally {
    await f.close();
  }
});
