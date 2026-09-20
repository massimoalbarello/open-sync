import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProviderDatabase } from '../src/db/providers';
import { createProviderController } from '../src/http/providers';
import { SqliteProviders } from '../src/repositories/providers/sqlite';
import { ProviderService } from '../src/services/providers/service';

const count = 65;
const invalidQueryStatus = 422;
const unauthorizedStatus = 401;
test('provider catalog bounds pages and searches the entire catalog before pagination behind authentication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'provider-pages-'));
  const db = openProviderDatabase(join(directory, 'providers.db'));
  try {
    const providers = new ProviderService({
      repository: new SqliteProviders(db),
      signal: new AbortController().signal,
      canConfigure: () => Promise.resolve(true),
      returnUrl: () => 'http://host/return',
      connector: {
        catalog: () =>
          Promise.resolve(
            Array.from({ length: count }).map(
              // biome-ignore lint/complexity/useMaxParams: Array.map supplies the item and index.
              (_, index) => ({
                service: `service_${index}`,
                displayName: `Provider ${index}`,
                iconUrl: null,
                categories: [{ id: 'dev', displayName: 'Developer' }],
                scenario: '',
                authTypes: ['api_key' as const],
              }),
            ),
          ),
        call: () => Promise.reject(new Error('Not used')),
      },
    });
    const app = createProviderController({
      providers,
      authorize: (request) =>
        request.headers.get('authorization') ? { actorId: 'owner', ownerId: 'owner' } : null,
    });
    const request = (path: string) =>
      app.handle(
        new Request(`http://localhost/providers/catalog${path}`, {
          headers: { authorization: 'test' },
        }),
      );
    const first = await (await request('')).json();
    const second = await (await request(`?offset=${first.pageSize}`)).json();
    const last = await (await request(`?offset=${first.pageSize * 2}`)).json();
    expect(first.providers.length).toBe(first.pageSize);
    expect(first.total).toBe(count);
    expect(first.hasMore).toBe(true);
    expect(last.hasMore).toBe(false);
    const ids = [...first.providers, ...second.providers, ...last.providers].map(
      (entry) => entry.service,
    );
    expect(new Set(ids).size).toBe(count);
    expect(
      (await (await request('?q=dev%2064%20api')).json()).providers.map(
        (entry: { service: string }) => entry.service,
      ),
    ).toEqual(['service_64']);
    expect((await (await request('?q=missingprovider')).json()).providers).toEqual([]);
    expect((await request('?offset=-1')).status).toBe(invalidQueryStatus);
    expect((await app.handle(new Request('http://localhost/providers/catalog'))).status).toBe(
      unauthorizedStatus,
    );
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('catalog requests share a runtime snapshot and retry a failed initial load', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-cache-'));
  const db = openProviderDatabase(join(directory, 'providers.db'));
  let loads = 0;
  const service = new ProviderService({
    repository: new SqliteProviders(db),
    canConfigure: () => Promise.resolve(true),
    signal: new AbortController().signal,
    returnUrl: () => 'http://host/return',
    connector: {
      catalog: () => {
        loads++;
        if (loads === 1) {
          return Promise.reject(new Error('temporary failure'));
        }
        return Promise.resolve([
          {
            service: 'github',
            displayName: 'GitHub',
            iconUrl: null,
            categories: [],
            scenario: '',
            authTypes: ['oauth2' as const],
          },
        ]);
      },
      call: () => Promise.reject(new Error('Unexpected call')),
    },
  });
  const owner = { actorId: 'owner', ownerId: 'owner' };
  try {
    await expect(service.catalogPage(owner)).rejects.toThrow('temporary failure');
    const pages = await Promise.all([
      service.catalogPage(owner),
      service.catalogPage({ ...owner, q: 'git' }),
      service.catalogPage({ ...owner, q: 'github' }),
      service.catalogPage({ ...owner, offset: 30 }),
    ]);
    expect(loads).toBe(2);
    expect(pages.map((page) => page.providers.length)).toEqual([1, 1, 1, 0]);
    expect((await service.catalogPage({ ...owner, q: 'oauth' })).providers[0]!.service).toBe(
      'github',
    );
    expect(loads).toBe(2);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
