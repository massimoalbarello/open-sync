import { expect, spyOn, test } from 'bun:test';
import type { SyncContext } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, configure, fixture, page, storage } from './support';

test('source and delivery failures use the same durable exponential backoff', async () => {
  const files = storage();
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  let failingSource = '';
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => ({
          step(context: SyncContext) {
            return context.syncId === failingSource
              ? Promise.reject(new Error('temporary'))
              : Promise.resolve({ ...page, complete: true });
          },
        }),
      },
    ],
    destinationTypes: {
      local: { ...accepted, deliver: () => Promise.reject(new Error('temporary')) },
    },
  });
  try {
    const source = await configure(engine);
    failingSource = source.id;
    const destinationSync = await configure(engine);
    await engine.tick();
    await engine.tick();
    const delays = Object.values({
      first: 30_000,
      second: 60_000,
      third: 120_000,
      fourth: 240_000,
      fifth: 480_000,
      sixth: 960_000,
      seventh: 1_920_000,
      eighth: 3_600_000,
      ninth: 3_600_000,
    });
    for (const delay of delays) {
      const due = now + delay;
      expect(engine.api.sync({ ...alpha, id: source.id }).nextDueAt).toBe(due);
      expect(
        engine.api.deliveries({ ...alpha, syncId: destinationSync.id }).deliveries[0]
          ?.nextAttemptAt,
      ).toBe(due);
      now = due;
      await engine.tick();
    }
  } finally {
    await engine.close();
    clock.mockRestore();
    files.close();
  }
});
