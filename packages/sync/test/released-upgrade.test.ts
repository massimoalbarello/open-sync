import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOpenSync as createPreviousOpenSync } from 'open-sync-previous';
import type { SyncRegistration } from '../src/models/definition';
import type { Deliverable, DeliveryResult } from '../src/models/delivery';
import { createOpenSync, type OpenSyncRuntime } from '../src/open-sync';
import { accepted, alpha, beta, fixture, storage } from './support';

const assetBody = 'attachment created by the released host';
const longInterval = 3_600_000;

// Create the data with the published package, not a reconstructed copy of its SQL schema.
// The registry tarball is pinned because an npm alias would resolve to this workspace package.
test('a host using published 0.3.1 upgrades its existing directory without resetting state', async () => {
  const files = storage();
  const dataDirectory = join(files.dir, 'open-sync');
  const databasePath = join(dataDirectory, 'sync.db');
  const resumed: unknown[] = [];
  const received: Array<Omit<Deliverable, 'openAsset'>> = [];
  const registration: SyncRegistration = {
    ...fixture,
    load: () => ({
      async step(context) {
        if (context.checkpoint !== 0) {
          throw new Error('temporary source failure');
        }
        const file = await context.assets.capture({
          id: 'attachment',
          version: '1',
          name: 'saved.txt',
          mediaType: 'text/plain',
          read: () => Promise.resolve(new Blob([assetBody]).stream()),
        });
        return {
          checkpoint: 1,
          complete: false,
          records: [
            {
              operation: 'upsert',
              kind: 'item',
              id: 'saved',
              data: { value: 1 },
              assetRefs: { file },
            },
          ],
        };
      },
    }),
  };
  const host = {
    dataDirectory,
    publicUrl: 'http://host/api/open-sync',
    authorize: () => alpha,
    canConfigureProviders: () => Promise.resolve(true),
  };
  let previous: Awaited<ReturnType<typeof createPreviousOpenSync>> | undefined;
  let current: OpenSyncRuntime | undefined;
  try {
    // The embedding application's own database is outside Open Sync's ownership.
    using hostDb = new Database(join(files.dir, 'app.db'));
    hostDb.exec('CREATE TABLE host_records(id TEXT PRIMARY KEY)');
    hostDb.query('INSERT INTO host_records VALUES (?)').run('existing-host-data');
    previous = await createPreviousOpenSync({
      ...host,
      definitions: [registration],
      destinationTypes: {
        local: {
          ...accepted,
          deliver: (): Promise<DeliveryResult> =>
            Promise.resolve({ status: 'rejected', code: 'receiver_unavailable' }),
        },
      },
    });
    await previous.providers.configure({
      ...alpha,
      service: 'github',
      values: { clientId: 'saved-client', clientSecret: 'saved-secret' },
    });
    const sync = await previous.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination: { type: 'local', input: {} },
      intervalMs: longInterval,
    });
    const paused = await previous.api.createSync({
      ...beta,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination: { type: 'local', input: {} },
      enabled: false,
      intervalMs: longInterval,
    });
    const scope = { ...alpha, id: sync.id };
    previous.start();
    await until(
      () =>
        previous!.api.sync(scope).status === 'retrying' &&
        previous!.api.deliveries({ ...alpha, syncId: sync.id }).deliveries[0]?.state === 'blocked',
    );
    const queued = previous.api.deliveries({ ...alpha, syncId: sync.id }).deliveries[0]!;
    const deliverable = previous.api.deliverable({ ...alpha, syncId: sync.id, id: queued.id });
    const before = previous.api.sync(scope);
    const pausedBefore = previous.api.sync({ ...beta, id: paused.id });
    const polls = previous.api.polls(scope);
    const providers = await previous.providers.status({ ...alpha, service: 'github' });
    await previous.close();
    previous = undefined;
    const key = await readFile(join(dataDirectory, '.connector-key'));
    using beforeDb = new Database(databasePath, { readonly: true });
    expect(
      beforeDb.query("SELECT name FROM sqlite_schema WHERE name='__migrations'").all(),
    ).toEqual([]);
    const records = beforeDb.query('SELECT * FROM record_state').all();
    const assets = beforeDb.query('SELECT * FROM delivery_assets').all();
    const upgradedOptions = {
      ...host,
      definitions: [
        {
          ...registration,
          load: () => ({
            step({ checkpoint }: { checkpoint: unknown }) {
              resumed.push(checkpoint);
              return Promise.resolve({ checkpoint: 2, records: [], complete: true });
            },
          }),
        },
      ],
      destinationTypes: {
        local: {
          ...accepted,
          async deliver({ deliverable }: { deliverable: Deliverable }): Promise<DeliveryResult> {
            const { openAsset, ...payload } = deliverable;
            expect(await new Response(await openAsset(deliverable.assets[0]!)).text()).toBe(
              assetBody,
            );
            received.push(payload);
            return { status: 'accepted' };
          },
        },
      },
    };
    current = await createOpenSync(upgradedOptions);
    const { intervalMs: _interval, nextDueAt: _due, ...retained } = before;
    const { intervalMs: _pausedInterval, nextDueAt: _pausedDue, ...retainedPaused } = pausedBefore;
    expect(current.api.sync(scope)).toEqual(retained);
    expect(current.api.sync({ ...beta, id: paused.id })).toEqual(retainedPaused);
    expect(() => current!.api.sync({ ...beta, id: sync.id })).toThrow('not found');
    expect(current.api.polls(scope)).toEqual(polls);
    expect(current.api.deliverable({ ...alpha, syncId: sync.id, id: queued.id })).toEqual(
      deliverable,
    );
    expect(await current.providers.status({ ...alpha, service: 'github' })).toEqual(providers);
    expect(await readFile(join(dataDirectory, '.connector-key'))).toEqual(key);
    using afterDb = new Database(databasePath, { readonly: true });
    expect(afterDb.query('SELECT * FROM record_state').all()).toEqual(records);
    expect(afterDb.query('SELECT * FROM delivery_assets').all()).toEqual(assets);
    expect(afterDb.query('PRAGMA foreign_key_check').all()).toEqual([]);
    const history = afterDb.query('SELECT * FROM __migrations ORDER BY name').all();
    expect(history).toHaveLength(2);
    await current.close();
    current = await createOpenSync(upgradedOptions);
    expect(afterDb.query('SELECT * FROM __migrations ORDER BY name').all()).toEqual(history);
    current.api.retryDelivery({ ...alpha, syncId: sync.id, id: queued.id });
    await current.runDue();
    expect(resumed).toEqual([1]);
    expect(received).toEqual([deliverable]);
    expect(current.api.sync(scope).status).toBe('succeeded');
    expect(current.api.sync({ ...beta, id: paused.id }).status).toBe('disabled');
    expect(current.api.status(alpha).queue.pendingRecords).toBe(0);
    expect(hostDb.query('SELECT * FROM host_records').all()).toEqual([
      { id: 'existing-host-data' },
    ]);
  } finally {
    await previous?.close();
    await current?.close();
    files.close();
  }
});

async function until(check: () => boolean) {
  const timeoutMs = 5_000;
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('Released host did not persist the expected state');
    }
    await Bun.sleep(1);
  }
}
