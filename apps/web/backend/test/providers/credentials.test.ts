import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';
import { connectorManagement } from '#backend/lib/connector/client.ts';
import { SqliteProviders } from '#backend/repositories/providers/sqlite.ts';
import { ProviderService } from '#backend/services/providers/service.ts';

const alice = { actorId: 'alice', ownerId: 'alice' };
const bob = { actorId: 'bob', ownerId: 'bob' };

test('credential connections use public Connector APIs and persist only owner-scoped references', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'provider-credentials-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'host.db') });
  try {
    await runMigrations({ db });
    const repository = new SqliteProviders(db);
    const connector = connectorManagement({
      baseUrl: 'http://connector',
      adminToken: 'admin',
      runtimeToken: 'runtime',
      // Connector is the external credential boundary; the host persistence adapter is real.
      fetch: async (request) => {
        expect(request.headers.get('authorization')).toBe('Bearer admin');
        expect(request.method).toBe('POST');
        const path = new URL(request.url).pathname;
        const apiKey = path.endsWith('/api-key');
        expect(path).toBe(
          `/v1/connections/example/connect/${apiKey ? 'api-key' : 'custom-credential'}`,
        );
        expect(await request.json()).toEqual(
          apiKey
            ? { apiKey: 'private-key', extra: { region: 'eu' } }
            : { values: { token: 'private-key', region: 'eu' } },
        );
        return Response.json({
          success: true,
          data: {
            id: crypto.randomUUID(),
            service: 'example',
            status: 'active',
            accountLabel: 'Example account',
          },
        });
      },
    });
    const service = new ProviderService({
      repository,
      connector,
      publicUrl: new URL('http://host'),
    });
    for (const authType of ['api_key', 'custom_credential'] as const) {
      await service.credentials({
        ...alice,
        service: 'example',
        authType,
        values: { [authType === 'api_key' ? 'apiKey' : 'token']: 'private-key', region: 'eu' },
      });
    }
    const connections = await repository.list(alice);
    expect(connections).toHaveLength(2);
    expect(JSON.stringify(connections)).not.toContain('private-key');
    expect(await repository.list(bob)).toEqual([]);
    for (const connection of connections) {
      expect(connection.service).toBe('example');
      expect(connection.account).toBe('Example account');
      expect(await repository.owns({ ...alice, connectorId: connection.connectorId })).toBe(true);
      expect(await repository.owns({ ...bob, connectorId: connection.connectorId })).toBe(false);
    }
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
