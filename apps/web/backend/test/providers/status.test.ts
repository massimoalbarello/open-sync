import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { SqliteProviders } from '#backend/repositories/providers/sqlite.ts';
import { ProviderService } from '#backend/services/providers/service.ts';

const owner = { actorId: 'owner', ownerId: 'owner' };
test('connection status checks only owned provider references and never reports failed lookups as connected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'provider-status-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  try {
    await runMigrations({ db });
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
      publicUrl: new URL('http://host'),
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
        { id: 'local', account: 'Owner', status: next === 'failed' ? 'unknown' : next },
      ]);
    }
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
