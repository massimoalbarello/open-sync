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

test('replacing a paused connection resets acquisition and preserves delivered records across restart', async () => {
  const files = storage();
  let reject = false;
  let validation: (() => Promise<unknown>) | undefined;
  const options = {
    databasePath: files.path,
    definitions: [registration],
    destinationTypes: { local: accepted },
    connector: {
      bind: async (input: { ownerId: string; connection: { id: string; service: string } }) => {
        await validation?.();
        if (reject || input.ownerId !== alpha.ownerId || input.connection.service !== 'github') {
          throw new Error('not found');
        }
        return {
          action: () => Promise.reject(new Error('unexpected request')),
          get: () => Promise.reject(new Error('unexpected request')),
          post: () => Promise.reject(new Error('unexpected request')),
        };
      },
    },
  };
  let engine = createSyncRuntime(options);
  try {
    const original = await engine.api.createSync({
      ...alpha,
      definition: registration.definition.id,
      destination: { type: 'local', input: {} },
      config: { count: 1 },
      connection: { id: 'old', service: 'github' },
    });
    const input = { ...alpha, id: original.id, connection: { id: 'new', service: 'github' } };
    await engine.tick();
    await engine.tick();
    const polls = engine.api.polls(input).polls;
    expect(polls[0]?.recordsQueued).toBe(1);
    await expect(engine.api.connectSync(input)).rejects.toThrow('already connected');
    await engine.api.setEnabled({ ...input, enabled: false });
    const before = savedSync({ path: files.path, scope: input });
    expect(before.checkpoint).toBe(1);
    await expect(engine.api.connectSync({ ...input, ...beta })).rejects.toThrow('not found');
    reject = true;
    await expect(engine.api.connectSync(input)).rejects.toThrow('not found');
    expect(savedSync({ path: files.path, scope: input })).toEqual(before);
    reject = false;
    // A concurrent resume during provider validation must defeat the replacement.
    validation = () => engine.api.setEnabled({ ...input, enabled: true });
    await expect(engine.api.connectSync(input)).rejects.toThrow('already connected');
    expect(engine.api.sync(input).connection?.id).toBe('old');
    validation = undefined;
    await engine.api.setEnabled({ ...input, enabled: false });
    const replacement = await engine.api.connectSync(input);
    expect(replacement).toMatchObject({
      id: original.id,
      enabled: false,
      connection: input.connection,
    });
    expect(savedSync({ path: files.path, scope: input }).checkpoint).toBe(0);
    await engine.close();
    engine = createSyncRuntime(options);
    expect(engine.api.sync(input)).toMatchObject(replacement);
    await engine.api.setEnabled({ ...input, enabled: true });
    await engine.tick();
    await engine.tick();
    expect(engine.api.polls(input).polls[0]).toMatchObject({
      state: 'succeeded',
      recordsQueued: 0,
    });
    expect(engine.api.sync(input).id).toBe(original.id);
  } finally {
    await engine.close();
    files.close();
  }
});
