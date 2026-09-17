import { expect, test } from 'bun:test';
import type { SyncRegistration } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, configure, fixture, page, runtime } from './support';

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
    const installation = await configure(f.engine);
    await f.engine.tick();
    expect(f.engine.api.installation({ ...alpha, id: installation.id }).checkpoint).toBe(1);
    expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(1);
    accept = true;
    const attempts = 8;
    for (let i = 0; i < attempts; i++) {
      await f.engine.tick();
    }
    expect(received).toHaveLength(count);
    expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(0);
    expect(f.engine.api.installation({ ...alpha, id: installation.id }).status).toBe('succeeded');
    f.engine.api.queueRun({ ...alpha, id: installation.id, backfill: true });
    await f.engine.tick();
    expect(received).toHaveLength(count);
  } finally {
    await f.close();
  }
});

test('committed pages survive generator failure and restart resumes from their checkpoint', async () => {
  const definition: SyncRegistration = {
    ...fixture,
    load: () => ({
      // biome-ignore lint/suspicious/useAwait: Failure fixture implements the async execution contract.
      async *run() {
        yield page;
        throw new Error('network interrupted');
      },
    }),
  };
  const f = runtime({ registration: definition });
  try {
    const installation = await configure(f.engine);
    await f.engine.tick();
    expect(f.engine.api.installation({ ...alpha, id: installation.id }).checkpoint).toBe(1);
    await f.engine.close();
    const resumed = createSyncRuntime({ ...f.options, definitions: [fixture] });
    try {
      resumed.api.queueRun({ ...alpha, id: installation.id });
      await resumed.tick();
      expect(resumed.api.installation({ ...alpha, id: installation.id }).checkpoint).toBe(count);
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
        async *run() {
          yield page;
          yield { ...page, checkpoint: 'invalid', complete: true };
        },
      }),
    },
  });
  try {
    const installation = await configure(f.engine);
    await f.engine.tick();
    const result = f.engine.api.installation({ ...alpha, id: installation.id });
    expect(result.checkpoint).toBe(1);
    expect(result.status).toBe('invalid_page');
  } finally {
    await f.close();
  }
});

test('definition versions are immutable and absent exact versions fail closed', async () => {
  const f = runtime();
  try {
    const installation = await configure(f.engine);
    await f.engine.close();
    expect(() =>
      createSyncRuntime({
        ...f.options,
        definitions: [{ ...fixture, definition: { ...fixture.definition, artifactId: 'changed' } }],
      }),
    ).toThrow('definition conflict');
    const absent = createSyncRuntime({ ...f.options, definitions: [] });
    try {
      await absent.tick();
      expect(absent.api.installation({ ...alpha, id: installation.id }).status).toBe(
        'definition_unavailable',
      );
      expect(absent.api.installation({ ...alpha, id: installation.id }).checkpoint).toBe(0);
    } finally {
      await absent.close();
    }
  } finally {
    await f.close();
  }
});

test('changing a destination implementation cannot reroute its queued deliveries', async () => {
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
          version: '2',
          deliver: () => {
            called = true;
            return Promise.resolve({ status: 'accepted' });
          },
        },
      },
    });
    try {
      await next.tick();
      expect(called).toBe(false);
      expect(next.api.status(alpha).queue.blockedDeliveries).toBe(1);
    } finally {
      await next.close();
    }
  } finally {
    await f.close();
  }
});

test('shutdown aborts trusted execution, closes the iterator, and leaves a resumable checkpoint', async () => {
  const entered = Promise.withResolvers<void>();
  let cleaned = false;
  const f = runtime({
    registration: {
      ...fixture,
      load: () => ({
        async *run({ signal }) {
          try {
            yield page;
            entered.resolve();
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            );
            signal.throwIfAborted();
          } finally {
            cleaned = true;
          }
        },
      }),
    },
  });
  try {
    await configure(f.engine);
    const tick = f.engine.tick();
    await entered.promise;
    await f.engine.close();
    await tick;
    expect(cleaned).toBe(true);
    expect(() => f.engine.api.installations(alpha)).toThrow('closed');
    const restarted = createSyncRuntime({ ...f.options, definitions: [fixture] });
    try {
      expect(restarted.api.installations(alpha)[0]?.checkpoint).toBe(1);
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
  }
});
