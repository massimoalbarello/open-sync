import { expect, spyOn, test } from 'bun:test';
import type { SyncEvent } from '../src/execution/diagnostics';
import { SyncError } from '../src/models/error';
import { defaultTiming } from '../src/models/limits';
import { Registry } from '../src/models/registry';
import { createSyncRuntime } from '../src/runtime';
import { AcquisitionService } from '../src/services/acquisition';
import { accepted, alpha, beta, configure, fixture, page, repositories, storage } from './support';

const retryMs = 30_000;
const maxBackoff = 3_600_000;

test.each(['paused', 'interrupted', 'timed_out', 'waiting_for_capacity'])(
  '%s distinguishes source failures from intentional waits',
  async (state) => {
    const f = repositories();
    const previousFailures = 2;
    const events: SyncEvent[] = [];
    const prior = f.acquisition.claim(defaultTiming.leaseMs)!;
    f.acquisition.finish({
      lease: prior,
      state: 'connector_request_failed',
      delay: 0,
      failureCount: previousFailures,
    });
    const service = new AcquisitionService({
      repository: f.acquisition,
      registry: new Registry({
        definitions: [
          {
            ...fixture,
            load: () => {
              throw new SyncError({ code: state, message: 'test' });
            },
          },
        ],
        destinations: { local: accepted },
      }),
      timing: defaultTiming,
      log: (event) => events.push(event),
    });
    try {
      const signal =
        state === 'waiting_for_capacity'
          ? new AbortController().signal
          : AbortSignal.abort(
              state === 'timed_out' ? new DOMException('deadline', 'TimeoutError') : state,
            );
      await service.execute({ lease: service.claim()!, signal });
      const failureDelay = 120_000;
      expect(events[0]).toMatchObject({
        code: state,
        fields: {
          failureCount: state === 'timed_out' ? previousFailures + 1 : previousFailures,
          retryAfterMs: state === 'timed_out' ? failureDelay : retryMs,
        },
      });
    } finally {
      f.close();
    }
  },
);

test('source failures back off durably despite partial progress and pruned history, then reset on success', async () => {
  const files = storage();
  const events: SyncEvent[] = [];
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  let failing = true;
  const options = {
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => ({
          // biome-ignore lint/suspicious/useAwait: The fixture implements the asynchronous execution boundary.
          async *run() {
            yield page;
            if (failing) {
              throw new Error('private upstream payload');
            }
            yield { ...page, complete: true };
          },
        }),
      },
    ],
    destinationTypes: { local: accepted },
    timing: { retryMs, historyLimit: 1 },
    onEvent: (event: SyncEvent) => events.push(event),
  };
  let engine = createSyncRuntime(options);
  try {
    const installation = await configure(engine);
    const scope = { ...alpha, id: installation.id };
    const delays = Object.values({
      first: 30_000,
      second: 60_000,
      third: 120_000,
      fourth: 240_000,
      fifth: 480_000,
      sixth: 960_000,
      seventh: 1_920_000,
      eighth: maxBackoff,
      ninth: maxBackoff,
    });
    for (const delay of delays) {
      await engine.tick();
      expect(engine.api.installation(scope)).toMatchObject({
        checkpoint: 1,
        status: 'execution_failed',
        nextDueAt: now + delay,
      });
      expect(events.at(-1)?.fields?.retryAfterMs).toBe(delay);
      const attempts = events.length;
      await engine.tick();
      expect(events).toHaveLength(attempts);
      now += delay - 1;
      await engine.tick();
      expect(events).toHaveLength(attempts);
      now++;
      // Reopen the actual SQLite database on each attempt, with history retained for just one run.
      await engine.close();
      engine = createSyncRuntime(options);
    }
    expect(events.at(-1)?.fields?.failureCount).toBe(delays.length);
    expect(JSON.stringify(events)).not.toContain('private upstream payload');
    expect(engine.api.polls(scope).polls[0]?.recordsChanged).toBe(1);

    // A different owner starts at the base delay, even while the first source is backed off.
    const destination = engine.api.createDestination({ ...beta, type: 'local', config: {} });
    const other = await engine.api.createInstallation({
      ...beta,
      definition: fixture.definition,
      config: { count: 1 },
      destinationId: destination.id,
    });
    await engine.tick();
    await engine.tick();
    expect(engine.api.installation({ ...beta, id: other.id }).nextDueAt).toBe(now + retryMs);
    await engine.api.setEnabled({ ...beta, id: other.id, enabled: false });

    failing = false;
    engine.api.queueRun(scope);
    await engine.tick();
    expect(engine.api.installation(scope).status).toBe('succeeded');
    failing = true;
    engine.api.queueRun(scope);
    await engine.tick();
    expect(engine.api.installation(scope).nextDueAt).toBe(now + retryMs);
    expect(events.at(-1)?.fields?.failureCount).toBe(1);
  } finally {
    await engine.close();
    clock.mockRestore();
    files.close();
  }
});

test('a provider cooldown is a lower bound and healthy checkpoint yields reset backoff', async () => {
  const files = storage();
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  let cooldown = 120_000;
  let failing = true;
  const options = {
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => ({
          // biome-ignore lint/suspicious/useAwait: The fixture implements the asynchronous execution boundary.
          async *run() {
            if (failing) {
              throw new SyncError({
                code: 'connector_request_failed',
                message: 'failure',
                retryAfterMs: cooldown,
              });
            }
            yield page;
          },
        }),
      },
    ],
    destinationTypes: { local: accepted },
    timing: { retryMs, maxPages: 1 },
  };
  const engine = createSyncRuntime(options);
  try {
    const installation = await configure(engine);
    const scope = { ...alpha, id: installation.id };
    await engine.tick();
    expect(engine.api.installation(scope).nextDueAt).toBe(now + cooldown);
    now += cooldown;
    cooldown = 1;
    await engine.tick();
    const secondDelay = 60_000;
    expect(engine.api.installation(scope).nextDueAt).toBe(now + secondDelay);
    now += secondDelay;
    failing = false;
    await engine.tick();
    expect(engine.api.installation(scope)).toMatchObject({ status: 'yielded', nextDueAt: now });
    failing = true;
    await engine.tick();
    expect(engine.api.installation(scope).nextDueAt).toBe(now + retryMs);
  } finally {
    await engine.close();
    clock.mockRestore();
    files.close();
  }
});
