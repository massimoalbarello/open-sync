import { expect, spyOn, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, configure, fixture, page, storage } from './support';

test('delivery failures retain exponential backoff independently of source polling', async () => {
  const files = storage();
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [
      {
        ...fixture,
        load: () => ({
          step() {
            return Promise.resolve({ ...page, complete: true });
          },
        }),
      },
    ],
    destinationTypes: {
      local: { ...accepted, deliver: () => Promise.reject(new Error('temporary')) },
    },
  });
  try {
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
      await engine.runDue();
      expect(
        engine.api.deliveries({ ...alpha, syncId: destinationSync.id }).deliveries[0]
          ?.nextAttemptAt,
      ).toBe(due);
      now = due;
      await engine.runDue();
    }
  } finally {
    await engine.close();
    clock.mockRestore();
    files.close();
  }
});
