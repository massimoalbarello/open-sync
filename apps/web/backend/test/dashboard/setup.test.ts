import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenSyncRuntime } from '@context-use/open-sync';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { destinationCredentials } from '#backend/lib/destination-credentials.ts';
import { DashboardService } from '#backend/services/dashboard/service.ts';

test('concurrent setup reuses local storage and authorization cannot strand or rebind a waiting sync', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-setup-'));
  const owner = { actorId: 'alice', ownerId: 'alice' };
  const connection = { id: 'owned', service: 'github' };
  const engine = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: [githubPullRequests],
    destinationTypes: {
      local: {
        version: '1',
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
    sealDestinationKey: destinationCredentials('test-secret').seal,
  });
  try {
    const input = { ...owner, source: 'github.pull-requests', destination: 'local' as const };
    const created = await Promise.all([dashboard.create(input), dashboard.create(input)]);
    expect(engine.api.destinations(owner)).toHaveLength(1);
    for (const sync of created) {
      expect(sync.authorizeService).toBeUndefined();
      expect(engine.api.installation({ ...owner, id: sync.id }).connection).toEqual(connection);
    }
    const destinationId = engine.api.destinations(owner)[0]!.id;
    const waiting = await engine.api.createInstallation({
      ...owner,
      definition: githubPullRequests.definition,
      config: {},
      destinationId,
      enabled: false,
    });
    await Promise.all([
      dashboard.connectWaiting({ ...owner, connection }),
      dashboard.connectWaiting({ ...owner, connection }),
    ]);
    const saved = engine.api.installation({ ...owner, id: waiting.id });
    expect(saved.enabled).toBe(true);
    expect(saved.bindingEpoch).toBe(waiting.bindingEpoch + 1);
    await dashboard.connectWaiting({
      ...owner,
      connection: { id: 'different', service: 'github' },
    });
    expect(engine.api.installation({ ...owner, id: waiting.id }).connection).toEqual(connection);
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});
