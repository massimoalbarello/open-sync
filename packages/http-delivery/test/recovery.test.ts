import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SyncRegistration } from '@open-sync/core/definition';
import { createSyncRuntime } from '@open-sync/core/engine';
import { createHttpDestination } from '../src';

const targetCount = 3;
const alpha = { actorId: 'alpha', ownerId: 'alpha' };
const fixture: SyncRegistration = {
  definition: {
    id: 'http-test',
    version: '1',
    artifactId: 'http-test/1',
    configSchema: { type: 'object' },
    checkpointSchema: { type: 'integer' },
    initialCheckpoint: 0,
    kinds: { item: { type: 'object' } },
  },
  load: () => ({
    // biome-ignore lint/suspicious/useAwait: Synthetic pages exercise transport persistence.
    async *run({ checkpoint }) {
      for (let index = Number(checkpoint); index < targetCount; index++) {
        yield {
          checkpoint: index + 1,
          complete: index + 1 === targetCount,
          deliverable: {
            records: [{ operation: 'upsert', kind: 'item', id: String(index), data: { index } }],
          },
        };
      }
    },
  }),
};
function storage() {
  const dir = mkdtempSync(join(tmpdir(), 'http-delivery-'));
  return {
    dir,
    path: join(dir, 'sync.db'),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
async function configure(engine: ReturnType<typeof createSyncRuntime>) {
  const destination = engine.api.createDestination({ ...alpha, type: 'local', config: {} });
  await engine.api.createInstallation({
    ...alpha,
    destinationId: destination.id,
    definition: fixture.definition,
    config: {},
  });
}

test('an HTTP receiver commit followed by failed acknowledgement is safely replayed after restart', async () => {
  const files = storage();
  const receiver = new Database(join(files.dir, 'receiver.db'));
  receiver.exec('CREATE TABLE receipts (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  const attempts: { id: string; body: string }[] = [];
  const acknowledgementLost = 503;
  const acceptedStatus = 204;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const id = request.headers.get('idempotency-key')!;
      const body = await request.text();
      attempts.push({ id, body });
      const previous = receiver
        .query<{ body: string }, [string]>('SELECT body FROM receipts WHERE id=?')
        .get(id);
      if (previous && previous.body !== body) {
        throw new Error('Retry body changed');
      }
      receiver.query('INSERT OR IGNORE INTO receipts VALUES (?,?)').run(id, body);
      return new Response(null, {
        status: attempts.length === 1 ? acknowledgementLost : acceptedStatus,
      });
    },
  });
  const options = {
    databasePath: files.path,
    definitions: [fixture],
    destinationTypes: {
      local: createHttpDestination({ endpoint: `http://127.0.0.1:${server.port}` }),
    },
  };
  const engine = createSyncRuntime(options);
  try {
    await configure(engine);
    await engine.tick();
    await engine.tick();
    expect(engine.api.status(alpha).queue.pendingRecords).toBe(targetCount);
    await engine.close();
    const resumed = createSyncRuntime(options);
    try {
      resumed.api.retryDelivery({ ...alpha, id: resumed.api.deliveries(alpha)[0]!.id });
      await resumed.tick();
      await resumed.tick();
      await resumed.tick();
      expect(attempts[0]).toEqual(attempts[1]);
      expect(
        receiver.query<{ count: number }, []>('SELECT count(*) AS count FROM receipts').get()!
          .count,
      ).toBe(targetCount);
      expect(resumed.api.status(alpha).queue.pendingBytes).toBe(0);
    } finally {
      await resumed.close();
    }
  } finally {
    await engine.close();
    await server.stop(true);
    receiver.close();
    files.close();
  }
});

test('changing HTTP credentials blocks old queued work at an unchanged URL', async () => {
  const files = storage();
  const unavailable = 503;
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch() {
      requests++;
      return new Response(null, { status: unavailable });
    },
  });
  const endpoint = `http://127.0.0.1:${server.port}`;
  const options = {
    databasePath: files.path,
    definitions: [fixture],
    destinationTypes: {
      local: createHttpDestination({ endpoint, bearerToken: 'original-recipient' }),
    },
  };
  const engine = createSyncRuntime(options);
  try {
    await configure(engine);
    await engine.tick();
    await engine.tick();
    await engine.close();
    const previousRequests = requests;
    const changed = createSyncRuntime({
      ...options,
      destinationTypes: {
        local: createHttpDestination({ endpoint, bearerToken: 'another-recipient' }),
      },
    });
    try {
      changed.api.retryDelivery({ ...alpha, id: changed.api.deliveries(alpha)[0]!.id });
      await changed.tick();
      expect(requests).toBe(previousRequests);
      expect(changed.api.status(alpha).queue.blockedDeliveries).toBe(1);
      expect(changed.api.status(alpha).queue.pendingRecords).toBe(targetCount);
    } finally {
      await changed.close();
    }
  } finally {
    await engine.close();
    await server.stop(true);
    files.close();
  }
});
