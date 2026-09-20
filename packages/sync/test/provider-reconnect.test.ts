import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProviderDatabase } from '../src/db/providers';
import { SqliteProviders } from '../src/repositories/providers/sqlite';
import { ProviderService } from '../src/services/providers/service';

const owner = { actorId: 'alice', ownerId: 'alice', service: 'github' };
test('reauthorization checks ownership, persists its attempt and preserves connection identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'provider-reconnect-'));
  const database = openProviderDatabase(join(directory, 'providers.db'));
  const repository = new SqliteProviders(database);
  const connection = {
    id: `connection_${crypto.randomUUID()}`,
    connectorId: 'existing',
    service: 'github',
    account: 'Alice',
  };
  let outcome = 'pending';
  let returnedId = connection.connectorId;
  let starts = 0;
  const notified: string[] = [];
  const options = {
    repository,
    canConfigure: () => Promise.resolve(true),
    signal: new AbortController().signal,
    returnUrl: ({ id }: { id: string }) => `http://host/providers/github/return/${id}`,
    onConnected: (input: { connection: { id: string } }) => {
      notified.push(input.connection.id);
      return Promise.resolve();
    },
    connector: {
      catalog: () => Promise.resolve([]),
      call: (input: { path: string }) => {
        if (input.path.endsWith('/connect')) {
          expect(input.path).toBe('/v1/connections/by-id/existing/connect');
          starts++;
          return Promise.resolve({
            authorizationUrl: 'https://github.com/consent',
            connectionRequestId: `attempt_${starts}`,
          });
        }
        if (input.path.includes('/connection-requests/')) {
          return Promise.resolve({ status: outcome, appId: returnedId });
        }
        if (input.path.endsWith('/api-key')) {
          expect(input.path).toBe('/v1/connections/by-id/existing/connect/api-key');
        }
        return Promise.resolve({
          id: returnedId,
          service: 'github',
          status: 'active',
          accountLabel: 'Alice refreshed',
        });
      },
    },
  };
  try {
    await repository.add({ ...owner, ...connection });
    let service = new ProviderService(options);
    const input = { ...owner, connectionId: connection.id };
    await expect(service.start({ ...input, actorId: 'bob', ownerId: 'bob' })).rejects.toThrow(
      'not found',
    );
    await expect(service.start({ ...input, service: 'other' })).rejects.toThrow('not found');
    expect(starts).toBe(0);
    await service.start(input);
    await service.start(input);
    await repository.complete({ ...owner, ...connection, requestId: 'attempt_1' });
    expect((await repository.pending({ ...owner, id: connection.id }))?.requestId).toBe(
      'attempt_2',
    );
    service = new ProviderService(options);
    await expect(service.complete({ ...owner, id: connection.id })).rejects.toThrow(
      'did not complete',
    );
    expect(notified).toEqual([]);
    outcome = 'connected';
    returnedId = 'different';
    await expect(service.complete({ ...owner, id: connection.id })).rejects.toThrow(
      'Invalid connection',
    );
    expect(await repository.list(owner)).toEqual([connection]);
    returnedId = connection.connectorId;
    await service.complete({ ...owner, id: connection.id });
    await service.complete({ ...owner, id: connection.id });
    expect(await repository.list(owner)).toEqual([{ ...connection, account: 'Alice refreshed' }]);
    expect(await repository.pending({ ...owner, id: connection.id })).toBeNull();
    expect(notified).toEqual([connection.id, connection.id]);
    await expect(
      service.credentials({
        ...input,
        ownerId: 'bob',
        actorId: 'bob',
        authType: 'api_key',
        values: { apiKey: 'test-key' },
      }),
    ).rejects.toThrow('not found');
    await service.credentials({ ...input, authType: 'api_key', values: { apiKey: 'test-key' } });
    expect(await repository.list(owner)).toEqual([{ ...connection, account: 'Alice refreshed' }]);
    expect(notified.at(-1)).toBe(connection.id);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
