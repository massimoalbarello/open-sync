import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectorRuntime } from '@oomol-lab/open-connector';
import { loadProviderKey } from '../src/connector/encryption-key';
import { connectorManagement } from '../src/connector/management';
import { openProviderDatabase } from '../src/db/providers';
import { SqliteProviders } from '../src/repositories/providers/sqlite';
import { ProviderService } from '../src/services/providers/service';

const alice = { actorId: 'alice', ownerId: 'alice', service: 'github' };
const bob = { actorId: 'bob', ownerId: 'bob', service: 'github' };

test('published Connector creates scoped OAuth consent and rejects denied callbacks without claiming a connection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-oauth-'));
  const key = await loadProviderKey(dir);
  expect(await loadProviderKey(dir)).toBe(key);
  const db = openProviderDatabase(join(dir, 'providers.db'));
  const connector = await createConnectorRuntime({
    dataDir: join(dir, 'connector'),
    publicOrigin: 'http://host/connector',
    adminToken: 'admin',
    runtimeToken: 'runtime',
    encryptionKey: key,
  });
  try {
    const repository = new SqliteProviders(db);
    const management = connectorManagement({
      baseUrl: 'http://host/connector',
      adminToken: 'admin',
      runtimeToken: 'runtime',
      signal: new AbortController().signal,
      fetch: (request) => connector.fetch(request),
    });
    const service = new ProviderService({
      repository,
      connector: management,
      returnUrl: ({ service, id }) => `http://host/api/providers/${service}/return/${id}`,
      canConfigure: () => Promise.resolve(true),
      signal: new AbortController().signal,
    });
    expect((await service.status(alice)).setup.oauthClient?.configured).toBe(false);
    const catalog = await service.catalog(alice);
    expect(
      catalog.some(
        (provider) => provider.service === 'github' && provider.authTypes.includes('api_key'),
      ),
    ).toBe(true);
    expect(catalog.some((provider) => provider.service !== 'github')).toBe(true);
    for (const type of ['custom_credential', 'no_auth'] as const) {
      const provider = catalog.find((entry) => entry.authTypes.includes(type))!;
      expect(
        (await service.status({ ...alice, service: provider.service })).setup.auth.some(
          (auth) => auth.type === type,
        ),
      ).toBe(true);
    }
    await expect(
      service.credentials({ ...alice, authType: 'api_key', values: {} }),
    ).rejects.toThrow('Provider could not complete');
    expect(await repository.list(alice)).toEqual([]);
    await service.configure({
      ...alice,
      values: {
        clientId: 'test-client',
        clientSecret: 'test-secret',
      },
    });
    const status = await service.status(alice);
    expect(status.setup.oauthClient).toMatchObject({
      configured: true,
      expectedRedirectUri: 'http://host/connector/oauth/callback',
    });
    expect(JSON.stringify(status)).not.toContain('test-secret');
    const started = new URL(
      (await service.start({ ...alice, authorizationOptionIds: ['read:user', 'repo'] }))
        .authorizationUrl,
    );
    expect(started.origin).toBe('https://github.com');
    expect(started.searchParams.get('scope')?.split(' ').sort()).toEqual(['read:user', 'repo']);
    expect(started.searchParams.get('redirect_uri')).toBe('http://host/connector/oauth/callback');
    const callback = await connector.fetch(
      new Request(
        `http://host/connector/oauth/callback?error=access_denied&state=${started.searchParams.get('state')}`,
      ),
    );
    const returned = new URL(callback.headers.get('location')!);
    expect(returned.origin).toBe('http://host');
    const id = returned.pathname.split('/').at(-1)!;
    await expect(service.complete({ ...bob, id })).rejects.toThrow('not found');
    await expect(service.complete({ ...alice, id })).rejects.toThrow('did not complete');
    expect(await repository.list(alice)).toEqual([]);
  } finally {
    await connector.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('only the owner of an active attempt can claim its public connection reference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-owner-'));
  const db = openProviderDatabase(join(dir, 'providers.db'));
  try {
    const repository = new SqliteProviders(db);
    const connection = {
      id: 'connection_alice',
      connectorId: 'connector_alice',
      account: 'alice-github',
      service: 'github',
    };
    await repository.start({ ...alice, id: 'superseded', requestId: 'request1' });
    await repository.start({ ...alice, id: connection.id, requestId: 'request2' });
    await repository.complete({ ...alice, ...connection, id: 'superseded' });
    await repository.complete({ ...bob, ...connection });
    expect(await repository.list(alice)).toEqual([]);
    const calls: string[] = [];
    const service = new ProviderService({
      repository,
      returnUrl: ({ service, id }) => `http://host/api/providers/${service}/return/${id}`,
      canConfigure: () => Promise.resolve(true),
      signal: new AbortController().signal,
      connector: {
        catalog: () => Promise.resolve([]),
        call: (input) => {
          calls.push(input.path);
          return Promise.resolve(
            input.path.includes('/connection-requests/')
              ? { status: 'connected', appId: connection.connectorId }
              : {
                  id: connection.connectorId,
                  service: 'github',
                  status: 'active',
                  providerAccountId: connection.account,
                },
          );
        },
      },
    });
    await expect(service.complete({ ...bob, id: connection.id })).rejects.toThrow('not found');
    await expect(
      service.complete({ ...alice, service: 'other', id: connection.id }),
    ).rejects.toThrow('not found');
    expect(calls).toEqual([]);
    await service.complete({ ...alice, id: connection.id });
    await service.complete({ ...alice, id: connection.id });
    expect(calls).toEqual([
      '/v1/connection-requests/request2',
      '/v1/connections/by-id/connector_alice',
    ]);
    expect(await repository.list(alice)).toEqual([connection]);
    expect(await service.connections(alice)).toEqual([
      { id: connection.id, service: connection.service, account: connection.account },
    ]);
    expect(await service.connections(bob)).toEqual([]);
    expect(await repository.connection({ ...bob, id: connection.id })).toBeNull();
    expect(await repository.owns({ ...bob, connectorId: connection.connectorId })).toBe(false);
    expect(await repository.pending({ ...alice, id: connection.id })).toBeNull();
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
