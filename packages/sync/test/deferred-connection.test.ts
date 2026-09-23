import { expect, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, beta, fixture, savedSync, storage } from './support';

const registration = {
  ...fixture,
  definition: { ...fixture.definition, provider: { service: 'github', actions: [] } },
};
test('a waiting sync survives restart, cannot run unbound and accepts its first owned connection exactly once', async () => {
  const files = storage();
  const options = {
    databasePath: files.path,
    definitions: [registration],
    destinationTypes: { local: accepted },
    connector: {
      bind(input: { ownerId: string; connection: { id: string; service: string } }) {
        if (
          input.ownerId !== alpha.ownerId ||
          input.connection.id !== 'owned' ||
          input.connection.service !== 'github'
        ) {
          return Promise.reject(new Error('not found'));
        }
        return Promise.resolve({
          action: () => Promise.reject(new Error('unexpected request')),
          get: () => Promise.reject(new Error('unexpected request')),
          post: () => Promise.reject(new Error('unexpected request')),
        });
      },
    },
  };
  let engine = createSyncRuntime(options);
  try {
    const destination = { type: 'local', input: {} };
    const create = {
      ...alpha,
      definition: registration.definition.id,
      destination,
      config: { count: 1 },
    };
    await expect(engine.api.createSync(create)).rejects.toThrow('connection required');
    const waiting = await engine.api.createSync({ ...create, enabled: false });
    await engine.tick();
    await engine.close();
    engine = createSyncRuntime(options);
    const id = waiting.id;
    expect(engine.api.sync({ ...alpha, id }).connection).toBeUndefined();
    await expect(engine.api.setEnabled({ ...alpha, id, enabled: true })).rejects.toThrow(
      'connection required',
    );
    await expect(
      engine.api.connectSync({
        ...beta,
        id,
        connection: { id: 'owned', service: 'github' },
      }),
    ).rejects.toThrow('not found');
    await expect(
      engine.api.connectSync({
        ...alpha,
        id,
        connection: { id: 'foreign', service: 'github' },
      }),
    ).rejects.toThrow('not found');
    expect(engine.api.sync({ ...alpha, id }).enabled).toBe(false);
    const connected = await engine.api.connectSync({
      ...alpha,
      id,
      connection: { id: 'owned', service: 'github' },
    });
    expect(connected.enabled).toBe(true);
    expect(connected.id).toBe(waiting.id);
    await expect(
      engine.api.connectSync({
        ...alpha,
        id,
        connection: { id: 'owned', service: 'github' },
      }),
    ).rejects.toThrow('already connected');
    await engine.tick();
    expect(savedSync({ path: files.path, scope: { ...alpha, id } }).checkpoint).toBeGreaterThan(0);
    await engine.close();
    engine = createSyncRuntime({ ...options, definitions: [] });
    expect((await engine.api.setEnabled({ ...alpha, id, enabled: false })).enabled).toBe(false);
  } finally {
    await engine.close();
    files.close();
  }
});
