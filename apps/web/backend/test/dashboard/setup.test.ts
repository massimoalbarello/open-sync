import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenSyncRuntime } from '@context-use/open-sync';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { DashboardService } from '#backend/services/dashboard/service.ts';

test('concurrent sync creation prepares local destinations and authorization cannot strand or rebind a waiting sync', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-setup-'));
  const owner = { actorId: 'alice', ownerId: 'alice' };
  const connection = { id: 'owned', service: 'github' };
  const engine = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: [githubPullRequests],
    destinationTypes: {
      local: {
        configSchema: { type: 'object' },
        deliver: () => Promise.resolve({ status: 'accepted' }),
      },
    },
    connector: {
      bind: () =>
        Promise.resolve({
          action: () => Promise.reject(new Error('unused')),
          get: () => Promise.reject(new Error('unused')),
          post: () => Promise.reject(new Error('unused')),
        }),
    },
  });
  let statusReads = 0;
  const status: OpenSyncRuntime['providers']['status'] = () => {
    statusReads++;
    return Promise.resolve({
      provider: {
        service: 'github',
        displayName: 'GitHub',
        iconUrl: null,
        categories: [],
        scenario: '',
        authTypes: ['oauth2'],
      },
      setup: { service: 'github', auth: [] },
      // The two initial reads race before account authorization completes.
      connections:
        statusReads > 2
          ? [{ id: connection.id, account: 'Alice', status: 'active', authType: 'oauth2' }]
          : [],
    });
  };
  const dashboard = new DashboardService({
    api: engine.api,
    providers: { status },
  });
  try {
    const input = {
      ...owner,
      source: 'github.pull-requests',
      destination: { type: 'local', input: {} },
    };
    const created = await Promise.all([dashboard.create(input), dashboard.create(input)]);
    for (const sync of created) {
      expect(sync.authorizeService).toBeUndefined();
      expect(engine.api.sync({ ...owner, id: sync.id }).connection).toEqual(connection);
    }
    const waiting = await engine.api.createSync({
      ...owner,
      definition: githubPullRequests.definition.id,
      config: {},
      destination: { type: 'local', input: {} },
      enabled: false,
    });
    await Promise.all([
      dashboard.connectWaiting({ ...owner, connection }),
      dashboard.connectWaiting({ ...owner, connection }),
    ]);
    const saved = engine.api.sync({ ...owner, id: waiting.id });
    expect(saved.enabled).toBe(true);
    expect(saved.connection).toEqual(connection);
    await dashboard.connectWaiting({
      ...owner,
      connection: { id: 'different', service: 'github' },
    });
    expect(engine.api.sync({ ...owner, id: waiting.id }).connection).toEqual(connection);
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('dashboard creates syncs with an unrelated destination using its own setup schema and preparation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-destination-'));
  const { provider: _provider, ...definition } = githubPullRequests.definition;
  const owner = { actorId: 'alice', ownerId: 'alice' };
  const engine = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: [{ ...githubPullRequests, definition }],
    destinationTypes: {
      archive: {
        configSchema: {
          type: 'object',
          properties: { bucket: { type: 'string' } },
          required: ['bucket'],
          additionalProperties: false,
        },
        setup: {
          schema: {
            type: 'object',
            properties: { project: { type: 'string', minLength: 1 } },
            required: ['project'],
            additionalProperties: false,
          },
          prepare: ({ scope, input }) => ({ bucket: `${scope.ownerId}/${input.project}` }),
        },
        deliver: () => Promise.resolve({ status: 'accepted' }),
      },
    },
  });
  const dashboard = new DashboardService({
    api: engine.api,
    providers: { status: () => Promise.reject(new Error('unused')) },
  });
  try {
    const input = {
      ...owner,
      source: 'github.pull-requests',
      destination: { type: 'archive', input: { project: 'research' }, ownerId: 'injected-owner' },
      config: { history: 'Last 1 year' },
    };
    const sync = await dashboard.create(input);
    expect(engine.api.sync({ ...owner, id: sync.id }).destinationType).toBe('archive');
    expect(engine.api.syncs({ ...owner, ownerId: 'injected-owner' })).toHaveLength(0);
    await expect(
      dashboard.create({
        ...input,
        config: { history: 'invalid' },
        destination: { type: 'archive', input: { project: 'should-not-exist' } },
      }),
    ).rejects.toThrow('Check the source settings.');
    await expect(
      dashboard.create({
        ...input,
        destination: { type: 'archive', input: { endpoint: 'wrong field' } },
      }),
    ).rejects.toThrow();
    expect(engine.api.syncs(owner)).toHaveLength(1);
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('sync creation binds the selected owned OAuth account and refuses ambiguous or unavailable accounts before setup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-accounts-'));
  const owner = { actorId: 'alice', ownerId: 'alice' };
  const engine = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: [githubPullRequests],
    destinationTypes: {
      local: {
        configSchema: { type: 'object' },
        deliver: () => Promise.resolve({ status: 'accepted' }),
      },
    },
    connector: {
      bind: () =>
        Promise.resolve({
          action: () => Promise.reject(new Error('unused')),
          get: () => Promise.reject(new Error('unused')),
          post: () => Promise.reject(new Error('unused')),
        }),
    },
  });
  let firstStatusEmpty = false;
  const status: OpenSyncRuntime['providers']['status'] = (scope) => {
    const empty = firstStatusEmpty;
    firstStatusEmpty = false;
    expect(scope).toMatchObject({ ...owner, service: 'github' });
    return Promise.resolve({
      provider: {
        service: 'github',
        displayName: 'GitHub',
        iconUrl: null,
        categories: [],
        scenario: '',
        authTypes: ['oauth2'],
      },
      setup: { service: 'github', auth: [] },
      connections: empty
        ? []
        : [
            { id: 'personal', account: 'Personal', status: 'active', authType: 'oauth2' },
            { id: 'work', account: 'Work', status: 'active', authType: 'oauth2' },
            { id: 'expired', account: 'Expired', status: 'reauth_required', authType: 'oauth2' },
            { id: 'key', account: 'API key', status: 'active', authType: 'api_key' },
          ],
    });
  };
  const dashboard = new DashboardService({ api: engine.api, providers: { status } });
  const input = {
    ...owner,
    source: 'github.pull-requests',
    destination: { type: 'local', input: {} },
  };
  try {
    for (const connectionId of [undefined, 'another-owner-account', 'expired', 'key']) {
      await expect(dashboard.create({ ...input, connectionId })).rejects.toThrow(
        'Select a connected account',
      );
    }
    expect(engine.api.syncs(owner)).toHaveLength(0);
    for (const connectionId of ['personal', 'work']) {
      const created = await dashboard.create({ ...input, connectionId });
      const saved = engine.api.sync({ ...owner, id: created.id });
      expect(created.authorizeService).toBeUndefined();
      expect(saved.connection).toEqual({ id: connectionId, service: 'github' });
      expect(saved.enabled).toBe(true);
    }
    expect(new Set(engine.api.syncs(owner).map((entry) => entry.id)).size).toBe(2);
    // Two accounts finish authorization during creation. The saved sync must not guess which to use.
    firstStatusEmpty = true;
    const waiting = await dashboard.create(input);
    expect(waiting.authorizeService).toBe('github');
    const resource = { ...owner, id: waiting.id };
    expect(engine.api.sync(resource)).toMatchObject({ enabled: false });
    expect(engine.api.sync(resource).connection).toBeUndefined();
    await dashboard.connectWaiting({ ...owner, connection: { id: 'work', service: 'github' } });
    expect(engine.api.sync(resource)).toMatchObject({
      enabled: true,
      connection: { id: 'work', service: 'github' },
    });
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});
