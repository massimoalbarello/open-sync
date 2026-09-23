import { expect, test } from 'bun:test';
import type { SyncRegistration } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, configure, fixture, page, runtime, savedSync } from './support';

const count = 3;

test('local delivery drains independently and unblocks bounded acquisition', async () => {
  const received: string[] = [];
  let accept = false;
  const f = runtime({
    maxPendingRecords: 1,
    destination: {
      ...accepted,
      deliver: ({ delivery }) => {
        if (!accept) {
          return Promise.resolve({ status: 'retry', retryAfterMs: 0 });
        }
        received.push(delivery.id);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    const sync = await configure(f.engine);
    await f.engine.tick();
    expect(savedSync({ path: f.files.path, scope: { ...alpha, id: sync.id } }).checkpoint).toBe(1);
    expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(1);
    accept = true;
    const attempts = 8;
    for (let i = 0; i < attempts; i++) {
      await f.engine.tick();
    }
    expect(received).toHaveLength(count);
    expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(0);
    expect(f.engine.api.sync({ ...alpha, id: sync.id }).status).toBe('succeeded');
    f.engine.api.queueRun({ ...alpha, id: sync.id, backfill: true });
    await f.engine.tick();
    expect(received).toHaveLength(count);
  } finally {
    await f.close();
  }
});

test('committed pages survive step failure and restart resumes from their checkpoint', async () => {
  const definition: SyncRegistration = {
    ...fixture,
    load: () => ({
      // biome-ignore lint/suspicious/useAwait: Failure fixture implements the async execution contract.
      async step({ checkpoint }) {
        if (checkpoint === 0) {
          return page;
        }
        throw new Error('network interrupted');
      },
    }),
  };
  const f = runtime({ registration: definition });
  try {
    const sync = await configure(f.engine);
    await f.engine.tick();
    await f.engine.tick();
    expect(savedSync({ path: f.files.path, scope: { ...alpha, id: sync.id } }).checkpoint).toBe(1);
    expect(f.engine.api.sync({ ...alpha, id: sync.id }).status).toBe('execution_failed');
    await f.engine.close();
    const resumed = createSyncRuntime({ ...f.options, definitions: [fixture] });
    try {
      resumed.api.queueRun({ ...alpha, id: sync.id });
      await resumed.tick();
      await resumed.tick();
      expect(savedSync({ path: f.files.path, scope: { ...alpha, id: sync.id } }).checkpoint).toBe(
        count,
      );
    } finally {
      await resumed.close();
    }
  } finally {
    await f.close();
  }
});

test('an invalid page cannot advance a valid earlier checkpoint', async () => {
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        // biome-ignore lint/suspicious/useAwait: Invalid output fixture implements the async execution contract.
        async step({ checkpoint }) {
          if (checkpoint === 0) {
            return page;
          }
          return { ...page, checkpoint: 'invalid', complete: true };
        },
      }),
    },
  });
  try {
    const sync = await configure(f.engine);
    await f.engine.tick();
    await f.engine.tick();
    const result = f.engine.api.sync({ ...alpha, id: sync.id });
    expect(savedSync({ path: f.files.path, scope: { ...alpha, id: sync.id } }).checkpoint).toBe(1);
    expect(result.status).toBe('invalid_page');
  } finally {
    await f.close();
  }
});

test('host manifests can change on restart and missing named sources fail closed', async () => {
  const f = runtime();
  try {
    const sync = await configure(f.engine);
    await f.engine.close();
    const changed = createSyncRuntime({
      ...f.options,
      definitions: [
        { ...fixture, definition: { ...fixture.definition, name: 'Changed host source' } },
      ],
    });
    expect(changed.api.definitions(alpha)[0]?.name).toBe('Changed host source');
    await changed.close();
    const absent = createSyncRuntime({ ...f.options, definitions: [] });
    try {
      await absent.tick();
      expect(absent.api.sync({ ...alpha, id: sync.id }).status).toBe('definition_unavailable');
      expect(savedSync({ path: f.files.path, scope: { ...alpha, id: sync.id } }).checkpoint).toBe(
        0,
      );
    } finally {
      await absent.close();
    }
  } finally {
    await f.close();
  }
});

test('queued deliveries resolve the current host destination implementation by name', async () => {
  const f = runtime({
    destination: {
      ...accepted,
      deliver: () => Promise.resolve({ status: 'retry', retryAfterMs: 0 }),
    },
  });
  try {
    await configure(f.engine);
    await f.engine.tick();
    await f.engine.close();
    let called = false;
    const next = createSyncRuntime({
      ...f.options,
      destinationTypes: {
        local: {
          ...accepted,
          deliver: () => {
            called = true;
            return Promise.resolve({ status: 'accepted' });
          },
        },
      },
    });
    try {
      await next.tick();
      expect(called).toBe(true);
      expect(next.api.status(alpha).queue.blockedDeliveries).toBe(0);
    } finally {
      await next.close();
    }
  } finally {
    await f.close();
  }
});

test('shutdown aborts trusted execution, cancels the step, and leaves a resumable checkpoint', async () => {
  const entered = Promise.withResolvers<void>();
  let cleaned = false;
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        async step({ signal, checkpoint }) {
          try {
            if (checkpoint === 0) {
              return page;
            }
            entered.resolve();
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            );
            signal.throwIfAborted();
            return page;
          } finally {
            cleaned = true;
          }
        },
      }),
    },
  });
  try {
    await configure(f.engine);
    await f.engine.tick();
    const tick = f.engine.tick();
    await entered.promise;
    await f.engine.close();
    await tick;
    expect(cleaned).toBe(true);
    expect(() => f.engine.api.syncs(alpha)).toThrow('closed');
    const restarted = createSyncRuntime({ ...f.options, definitions: [fixture] });
    try {
      expect(
        savedSync({
          path: f.files.path,
          scope: { ...alpha, id: restarted.api.syncs(alpha)[0]!.id },
        }).checkpoint,
      ).toBe(1);
      const sync = restarted.api.syncs(alpha)[0]!;
      expect(restarted.api.polls({ ...alpha, id: sync.id }).polls[0]).toMatchObject({
        state: 'interrupted',
        recordsProcessed: 1,
      });
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
  }
});
