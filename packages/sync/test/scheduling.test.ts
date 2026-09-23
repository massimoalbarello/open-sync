import { expect, test } from 'bun:test';
import type { SyncRegistration } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import {
  accepted,
  alpha,
  configure,
  fixture,
  page,
  repositories,
  savedSync,
  storage,
} from './support';

const deadlineMs = 2000;
async function until(check: () => boolean) {
  const deadline = Date.now() + deadlineMs;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('Worker did not make progress');
    }
    await Bun.sleep(1);
  }
}

test('waiting sources and deliveries do not stop other steps, even at the same destination', async () => {
  const files = storage();
  const heldSource = Promise.withResolvers<void>();
  const heldDelivery = Promise.withResolvers<void>();
  let slowSource = '';
  let slowDelivery = '';
  const delivered: string[] = [];
  const source: SyncRegistration = {
    ...fixture,
    load: async () => {
      const executable = await fixture.load();
      return {
        async step(context) {
          if (context.syncId === slowSource) {
            await heldSource.promise;
          }
          return executable.step(context);
        },
      };
    },
  };
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [source],
    timing: { sourceConcurrency: 2, deliveryConcurrency: 2 },
    destinationTypes: {
      local: {
        ...accepted,
        async deliver({ deliverable: delivery }) {
          if (delivery.syncId === slowDelivery) {
            await heldDelivery.promise;
          }
          delivered.push(delivery.syncId);
          return { status: 'accepted' };
        },
      },
    },
  });
  try {
    const destination = { type: 'local', input: {} };
    const installs: Awaited<ReturnType<typeof configure>>[] = [];
    const syncCount = 3;
    for (let i = 0; i < syncCount; i++) {
      installs.push(
        await engine.api.createSync({
          ...alpha,
          definition: fixture.definition.id,
          config: { count: 3 },
          destination,
        }),
      );
    }
    slowSource = installs[0]!.id;
    slowDelivery = installs[1]!.id;
    engine.start();
    engine.start();
    await until(() => delivered.filter((id) => id === installs[2]!.id).length === syncCount);
    expect(
      savedSync({ path: files.path, scope: { ...alpha, id: installs[0]!.id } }).checkpoint,
    ).toBe(0);
    expect(delivered).not.toContain(slowDelivery);
    heldSource.resolve();
    heldDelivery.resolve();
    await until(
      () =>
        engine.api.status(alpha).queue.pendingRecords === 0 &&
        engine.api.sync({ ...alpha, id: installs[0]!.id }).status === 'succeeded',
    );
    expect(delivered).toHaveLength(syncCount * syncCount);
  } finally {
    heldSource.resolve();
    heldDelivery.resolve();
    await engine.close();
    files.close();
  }
});

test('an uncooperative step times out, releases its slot, and cannot commit a late result', async () => {
  const files = storage();
  const late = Promise.withResolvers<typeof page>();
  let held = '';
  const timeoutMs = 50;
  const source: SyncRegistration = {
    ...fixture,
    load: async () => {
      const executable = await fixture.load();
      return {
        step: (context) => (context.syncId === held ? late.promise : executable.step(context)),
      };
    },
  };
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [source],
    destinationTypes: { local: accepted },
    timing: { sourceConcurrency: 1, timeoutMs },
  });
  try {
    const first = await configure(engine);
    held = first.id;
    const other = await configure(engine);
    engine.start();
    await until(
      () =>
        engine.api.sync({ ...alpha, id: other.id }).status === 'succeeded' &&
        engine.api.status(alpha).queue.pendingRecords === 0,
    );
    expect(engine.api.sync({ ...alpha, id: first.id }).status).toBe('timed_out');
    late.resolve(page);
    await Bun.sleep(1);
    expect(savedSync({ path: files.path, scope: { ...alpha, id: first.id } }).checkpoint).toBe(0);
    expect(engine.api.status(alpha).queue.pendingRecords).toBe(0);
  } finally {
    await engine.close();
    files.close();
  }
});

test('idle workers wake for new work and retries wait until their persisted due time', async () => {
  const files = storage();
  const times: number[] = [];
  const retryMs = 50;
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [fixture],
    destinationTypes: {
      local: {
        ...accepted,
        deliver: () => {
          times.push(Date.now());
          return Promise.resolve(
            times.length === 1
              ? { status: 'retry', retryAfterMs: retryMs }
              : { status: 'accepted' },
          );
        },
      },
    },
  });
  try {
    engine.start();
    await Bun.sleep(1);
    await configure(engine);
    const deliveries = 4;
    await until(() => times.length === deliveries);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(retryMs);
    expect(engine.api.status(alpha).queue.pendingRecords).toBe(0);
  } finally {
    await engine.close();
    files.close();
  }
});

test.each(['blocked', 'leased', 'retry'] as const)(
  '%s delivery holds only its sync–destination pair',
  (state) => {
    const f = repositories();
    const leaseMs = 60_000;
    try {
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        page,
        definition: fixture.definition,
      });
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        page: {
          ...page,
          records: [{ ...page.records[0]!, id: 'next' }],
        },
        definition: fixture.definition,
      });
      const first = f.deliveries.claim(leaseMs)!;
      if (state === 'leased') {
        expect(() => f.deliveries.retry({ ...alpha, id: first.delivery.id })).toThrow('busy');
      }
      if (state !== 'leased') {
        f.deliveries.complete({
          lease: first,
          result:
            state === 'blocked' ? { status: 'rejected', code: 'rejected' } : { status: 'retry' },
          delay: leaseMs,
        });
      }
      f.catalog.setEnabled({ ...alpha, id: f.sync.id, enabled: false });
      const other = f.catalog.createSync({
        ...alpha,
        definition: fixture.definition.id,
        config: { count: 1 },
        destination: f.sync.destination,
        initialCheckpoint: 0,
      });
      f.acquisition.commit({
        lease: f.acquisition.claim(leaseMs)!,
        page,
        definition: fixture.definition,
      });
      const independent = f.deliveries.claim(leaseMs)!;
      expect(independent.delivery.syncId).toBe(other.id);
      expect(f.deliveries.claim(leaseMs)).toBeUndefined();
      f.deliveries.complete({ lease: independent, result: { status: 'accepted' }, delay: 0 });
      if (state === 'leased') {
        f.deliveries.complete({ lease: first, result: { status: 'accepted' }, delay: 0 });
        expect(f.deliveries.claim(leaseMs)?.delivery.records[0]?.id).toBe('next');
      }
    } finally {
      f.close();
    }
  },
);

test('a delivery that ignores abort cannot hold shutdown or acknowledge after its deadline', async () => {
  const files = storage();
  const late = Promise.withResolvers<{ status: 'accepted' }>();
  const timeoutMs = 30;
  const options = {
    databasePath: files.path,
    definitions: [fixture],
    destinationTypes: { local: { ...accepted, deliver: () => late.promise } },
    timing: { timeoutMs },
  };
  const engine = createSyncRuntime(options);
  try {
    const destination = { type: 'local', input: {} };
    await engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination,
    });
    await engine.tick();
    await engine.tick();
    const before = engine.api.deliveries(alpha).deliveries[0]!;
    expect(before.errorCode).toBe('delivery_failed');
    await engine.close();
    late.resolve({ status: 'accepted' });
    await Bun.sleep(1);
    const reopened = createSyncRuntime(options);
    try {
      expect(reopened.api.deliveries(alpha).deliveries[0]).toEqual(before);
    } finally {
      await reopened.close();
    }
  } finally {
    await engine.close();
    files.close();
  }
});
