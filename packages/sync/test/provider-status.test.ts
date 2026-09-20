import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProviderDatabase } from '../src/db/providers';
import { SqliteProviders } from '../src/repositories/providers/sqlite';
import { ProviderService } from '../src/services/providers/service';

const owner = { actorId: 'owner', ownerId: 'owner' };
test('connection status checks only owned provider references and never reports failed lookups as connected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'provider-status-'));
  const db = openProviderDatabase(join(dir, 'providers.db'));
  try {
    const repository = new SqliteProviders(db);
    await repository.add({
      ...owner,
      id: 'local',
      connectorId: 'owned',
      service: 'github',
      account: 'Owner',
    });
    await repository.add({
      actorId: 'other',
      ownerId: 'other',
      id: 'foreign',
      connectorId: 'foreign',
      service: 'github',
      account: 'Other',
    });
    let status = 'active';
    const service = new ProviderService({
      repository,
      returnUrl: ({ service, id }) => `http://host/api/providers/${service}/return/${id}`,
      canConfigure: () => Promise.resolve(true),
      signal: new AbortController().signal,
      connector: {
        catalog: () =>
          Promise.resolve([
            {
              service: 'github',
              displayName: 'GitHub',
              iconUrl: null,
              categories: [],
              scenario: '',
              authTypes: [],
            },
          ]),
        call: ({ path }) => {
          if (path.endsWith('/setup')) {
            return Promise.resolve({ auth: [] });
          }
          expect(path).toBe('/v1/connections/by-id/owned');
          if (status === 'failed') {
            return Promise.reject(new Error('Connector unavailable'));
          }
          return Promise.resolve({ id: 'owned', service: 'github', status });
        },
      },
    });
    for (const next of ['active', 'reauth_required', 'failed']) {
      status = next;
      expect((await service.status({ ...owner, service: 'github' })).connections).toEqual([
        {
          id: 'local',
          account: 'Owner',
          status: next === 'failed' ? 'unknown' : next,
          authType: undefined,
        },
      ]);
    }
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
