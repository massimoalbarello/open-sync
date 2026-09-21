import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectorRuntime } from '@oomol-lab/open-connector';
import { loadProviderKey } from '../src/connector/encryption-key';
import { connectorManagement } from '../src/connector/management';
import { openProviderDatabase } from '../src/db/providers';
import type { OAuthClientRegistration } from '../src/models/providers';
import { SqliteProviders } from '../src/repositories/providers/sqlite';
import { ProviderService } from '../src/services/providers/service';

const alice = { actorId: 'alice', ownerId: 'alice', service: 'granola' };
const bob = { actorId: 'bob', ownerId: 'bob', service: 'granola' };

async function fixture(input: {
  register: OAuthClientRegistration;
  beforeRequest?: (request: Request) => Promise<void>;
}) {
  const dir = await mkdtemp(join(tmpdir(), 'provider-registration-'));
  const key = await loadProviderKey(dir);
  const db = openProviderDatabase(join(dir, 'providers.db'));
  const repository = new SqliteProviders(db);
  const controller = new AbortController();
  const options = {
    dataDir: join(dir, 'connector'),
    publicOrigin: 'http://host/connector',
    adminToken: 'admin',
    runtimeToken: 'runtime',
    encryptionKey: key,
  };
  let connector = await createConnectorRuntime(options);
  const createService = () =>
    new ProviderService({
      repository,
      connector: connectorManagement({
        ...options,
        baseUrl: options.publicOrigin,
        signal: controller.signal,
        fetch: async (request) => {
          await input.beforeRequest?.(request);
          return connector.fetch(request);
        },
      }),
      returnUrl: ({ service, id }) => `http://host/api/providers/${service}/return/${id}`,
      canConfigure: (scope) => Promise.resolve(scope.actorId === 'alice'),
      registrations: { granola: input.register },
      signal: controller.signal,
    });
  let service = createService();
  return {
    get service() {
      return service;
    },
    async restart() {
      await connector.close();
      connector = await createConnectorRuntime(options);
      service = createService();
    },
    async close() {
      controller.abort();
      await connector.close();
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('registration requires configuration permission, coalesces starts, and reuses the persisted client after restart', async () => {
  const entered = Promise.withResolvers<void>();
  const registered = Promise.withResolvers<{ clientId: string }>();
  let registrations = 0;
  const f = await fixture({
    register: async (input) => {
      registrations++;
      expect(input.redirectUri).toBe('http://host/connector/oauth/callback');
      expect(input.scopes).toContain('offline_access');
      entered.resolve();
      return await registered.promise;
    },
  });
  try {
    expect((await f.service.status(alice)).setup.oauthClient).toMatchObject({
      configured: false,
      automaticRegistration: true,
    });
    await expect(f.service.start(bob)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(f.service.start({ ...alice, connectionId: 'unowned' })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(registrations).toBe(0);
    const starts = Promise.all([f.service.start(alice), f.service.start(alice)]);
    await entered.promise;
    registered.resolve({ clientId: 'registered-client' });
    const authorizations = await starts;
    for (const result of authorizations) {
      const url = new URL(result.authorizationUrl);
      expect(url.searchParams.get('client_id')).toBe('registered-client');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
    }
    expect(authorizations[0]?.authorizationUrl).not.toBe(authorizations[1]?.authorizationUrl);
    await f.restart();
    expect((await f.service.status(alice)).setup.oauthClient?.configured).toBe(true);
    // Once configured, account owners do not need instance configuration permission to connect.
    expect(
      new URL((await f.service.start(bob)).authorizationUrl).searchParams.get('client_id'),
    ).toBe('registered-client');
    expect(registrations).toBe(1);
  } finally {
    await f.close();
  }
});

test('failed registrations expose no upstream details and can retry without replacing an explicit client configuration', async () => {
  let registrations = 0;
  const f = await fixture({
    register: () => {
      registrations++;
      return registrations === 1
        ? Promise.reject(new Error('upstream-secret'))
        : Promise.resolve({ clientId: 'registered-client' });
    },
  });
  try {
    await expect(f.service.start(alice)).rejects.toMatchObject({
      code: 'provider_request_failed',
      message: 'Could not register the OAuth client. Try connecting again.',
    });
    expect((await f.service.status(alice)).setup.oauthClient?.configured).toBe(false);
    await f.service.start(alice);
    expect(registrations).toBe(2);
    await f.service.configure({ ...alice, values: { clientId: 'manual-client' } });
    await f.restart();
    expect(
      new URL((await f.service.start(alice)).authorizationUrl).searchParams.get('client_id'),
    ).toBe('manual-client');
    expect(registrations).toBe(2);
  } finally {
    await f.close();
  }
});

test('explicit configuration waits for an in-flight registration and takes precedence', async () => {
  const entered = Promise.withResolvers<void>();
  const registered = Promise.withResolvers<{ clientId: string }>();
  const f = await fixture({
    register: () => {
      entered.resolve();
      return registered.promise;
    },
  });
  try {
    const start = f.service.start(alice);
    await entered.promise;
    const configured = f.service.configure({ ...alice, values: { clientId: 'manual-client' } });
    registered.resolve({ clientId: 'registered-client' });
    await Promise.all([start, configured]);
    expect(
      new URL((await f.service.start(alice)).authorizationUrl).searchParams.get('client_id'),
    ).toBe('manual-client');
  } finally {
    await f.close();
  }
});

test('registration queued during manual setup reuses the manually configured client', async () => {
  const entered = Promise.withResolvers<void>();
  const proceed = Promise.withResolvers<void>();
  const registered = Promise.withResolvers<{ clientId: string }>();
  let registrations = 0;
  let firstSetup = true;
  const f = await fixture({
    register: () => {
      registrations++;
      return registered.promise;
    },
    beforeRequest: async (request) => {
      if (firstSetup && new URL(request.url).pathname.endsWith('/providers/granola/setup')) {
        firstSetup = false;
        entered.resolve();
        await proceed.promise;
      }
    },
  });
  try {
    const configured = f.service.configure({ ...alice, values: { clientId: 'manual-client' } });
    await entered.promise;
    const start = f.service.start(alice);
    // Let another Connector request complete while manual configuration is still suspended.
    await f.service.status(alice);
    proceed.resolve();
    await configured;
    registered.resolve({ clientId: 'registered-client' });
    const authorization = await start;
    expect(new URL(authorization.authorizationUrl).searchParams.get('client_id')).toBe(
      'manual-client',
    );
    expect(registrations).toBe(0);
    await f.restart();
    expect(
      new URL((await f.service.start(bob)).authorizationUrl).searchParams.get('client_id'),
    ).toBe('manual-client');
  } finally {
    proceed.resolve();
    registered.resolve({ clientId: 'registered-client' });
    await f.close();
  }
});
