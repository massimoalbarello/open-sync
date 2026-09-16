import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectorRuntime } from '@oomol-lab/open-connector';
import { createSyncRuntime } from '@open-sync/core';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { connectorManagement } from '#backend/lib/connector/client.ts';
import { loadConnectorKey } from '#backend/lib/connector/encryption-key.ts';
import { SqliteProviders } from '#backend/repositories/providers/sqlite.ts';
import { githubPullRequests } from '#backend/services/github-sync/definition.ts';
import { GithubSyncService } from '#backend/services/github-sync/service.ts';
import { ProviderService } from '#backend/services/providers/service.ts';

const alice = { actorId: 'alice', ownerId: 'alice', service: 'github' };
const bob = { actorId: 'bob', ownerId: 'bob', service: 'github' };

test('published Connector creates scoped OAuth consent and rejects denied callbacks without claiming a connection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-oauth-'));
  const key = await loadConnectorKey(dir);
  expect(await loadConnectorKey(dir)).toBe(key);
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  const connector = await createConnectorRuntime({
    dataDir: join(dir, 'connector'),
    publicOrigin: 'http://host/connector',
    adminToken: 'admin',
    runtimeToken: 'runtime',
    encryptionKey: key,
  });
  const sync = createSyncRuntime({
    databasePath: join(dir, 'sync.db'),
    definitions: [githubPullRequests],
    destinationTypes: {},
  });
  try {
    await runMigrations({ db });
    const repository = new SqliteProviders(db);
    const management = connectorManagement({
      baseUrl: 'http://host/connector',
      adminToken: 'admin',
      runtimeToken: 'runtime',
      fetch: (request) => connector.fetch(request),
    });
    const service = new ProviderService({
      repository,
      connector: management,
      publicUrl: new URL('http://host'),
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
    ).rejects.toThrow('Open Connector could not complete');
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
    await expect(service.complete({ ...bob, id })).rejects.toThrow('Not Found');
    await expect(service.complete({ ...alice, id })).rejects.toThrow('did not complete');
    expect(await repository.list(alice)).toEqual([]);
  } finally {
    await sync.close();
    await connector.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('only the owner of an active attempt can claim its public connection reference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-owner-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  const sync = createSyncRuntime({
    databasePath: join(dir, 'sync.db'),
    definitions: [githubPullRequests],
    destinationTypes: {},
  });
  try {
    await runMigrations({ db });
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
      publicUrl: new URL('http://host'),
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
    await expect(service.complete({ ...bob, id: connection.id })).rejects.toThrow('Not Found');
    await expect(
      service.complete({ ...alice, service: 'other', id: connection.id }),
    ).rejects.toThrow('Not Found');
    const github = new GithubSyncService({ repository, sync: sync.api });
    await expect(github.create({ ...bob, id: connection.id })).rejects.toThrow('Not Found');
    expect(calls).toEqual([]);
    await service.complete({ ...alice, id: connection.id });
    await service.complete({ ...alice, id: connection.id });
    expect(calls).toEqual([
      '/v1/connection-requests/request2',
      '/v1/connections/by-id/connector_alice',
    ]);
    expect(await repository.list(alice)).toEqual([connection]);
    expect(await github.connections(alice)).toEqual([
      { id: connection.id, account: connection.account },
    ]);
    expect(await github.connections(bob)).toEqual([]);
    expect(await repository.connection({ ...bob, id: connection.id })).toBeNull();
    expect(await repository.owns({ ...bob, connectorId: connection.connectorId })).toBe(false);
    expect(await repository.pending({ ...alice, id: connection.id })).toBeNull();
  } finally {
    await sync.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
