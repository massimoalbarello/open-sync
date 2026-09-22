import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Delivery } from '../src/models/delivery';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, fixture, storage } from './support';

const targetCount = 3;

test('SIGKILL recovery reclaims expired acquisition and delivery without changing the queued payload', async () => {
  const files = storage();
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'crash-worker.ts'), files.dir],
      { stderr: 'pipe' },
    );
    await child.exited;
    expect(child.signalCode).toBe('SIGKILL');
    const db = new Database(files.path);
    const original = db.query<{ body: string }, []>('SELECT body FROM deliveries').get()!.body;
    // Expire durable leases deterministically; the process actually died with both leases held.
    db.exec('UPDATE runs SET expires_at=0; UPDATE deliveries SET expires_at=0');
    db.close();
    const delivered: Delivery[] = [];
    const engine = createSyncRuntime({
      databasePath: files.path,
      definitions: [fixture],
      destinationTypes: {
        local: {
          ...accepted,
          deliver: ({ delivery }) => {
            delivered.push(delivery);
            return Promise.resolve({ status: 'accepted' });
          },
        },
      },
    });
    try {
      expect(engine.api.installations(alpha)[0]?.checkpoint).toBe(1);
      await engine.tick();
      await engine.tick();
      await engine.tick();
      expect(delivered[0]).toEqual(JSON.parse(original));
      expect(engine.api.installations(alpha)[0]?.checkpoint).toBe(targetCount);
      expect(engine.api.status(alpha).queue.pendingRecords).toBe(0);
      const installation = engine.api.installations(alpha)[0]!;
      expect(engine.api.polls({ ...alpha, id: installation.id }).polls[0]).toMatchObject({
        state: 'succeeded',
        recordsProcessed: targetCount,
        recordsChanged: targetCount,
        attemptCount: 4,
      });
    } finally {
      await engine.close();
    }
  } finally {
    files.close();
  }
});
