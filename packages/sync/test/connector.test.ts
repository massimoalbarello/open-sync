import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createConnectorRuntime } from '@oomol-lab/open-connector';
import { createConnectorClient } from '../src/connector/client';
import { alpha, storage } from './support';

const ok = 200;
const unauthorized = 401;

test('the installed Connector package owns auth, metadata and storage under a host prefix', async () => {
  const files = storage();
  const connector = await createConnectorRuntime({
    dataDir: join(files.dir, 'connector'),
    publicOrigin: 'http://host/connector',
    adminToken: 'test-admin',
    runtimeToken: 'test-runtime',
    encryptionKey: 'test-encryption',
  });
  const request = (input: { path: string; token?: string }) =>
    connector.fetch(
      new Request(`http://host/connector${input.path}`, {
        headers: input.token ? { authorization: `Bearer ${input.token}` } : {},
      }),
    );
  try {
    expect((await request({ path: '/v1/connections' })).status).toBe(unauthorized);
    expect((await request({ path: '/v1/connections', token: 'test-runtime' })).status).toBe(
      unauthorized,
    );
    const connections = await request({ path: '/v1/connections', token: 'test-admin' });
    expect(connections.status).toBe(ok);
    expect(((await connections.json()) as { data: unknown[] }).data).toEqual([]);
    const providers = await request({ path: '/v1/providers', token: 'test-runtime' });
    expect(((await providers.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
    const setup = await request({ path: '/v1/providers/github/setup', token: 'test-admin' });
    expect(JSON.stringify(await setup.json())).toContain('http://host/connector/oauth/callback');
    const client = createConnectorClient({
      fetch: (req) => connector.fetch(req),
      baseUrl: 'http://host/connector',
      adminToken: 'test-admin',
      runtimeToken: 'test-runtime',
      authorizeConnection: () => Promise.resolve(true),
    });
    await expect(
      client.bind({
        ...alpha,
        connection: { id: 'missing', service: 'github' },
        requirements: { service: 'github', actions: [], requiredScopes: [] },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('connector request failed');
  } finally {
    await connector.close();
    files.close();
  }
});

test('provider access authorizes ownership before metadata, scopes and declared operations', async () => {
  const requests: Request[] = [];
  let authorized = false;
  let status = 'reauth_required';
  let scopes: string[] = [];
  let actionService = 'other';
  const client = createConnectorClient({
    baseUrl: 'http://host/connector',
    adminToken: 'backend-admin',
    runtimeToken: 'backend-runtime',
    authorizeConnection: () => Promise.resolve(authorized),
    fetch: (request) => {
      requests.push(request);
      const data = request.url.includes('by-id')
        ? { id: 'connection', service: 'synthetic', alias: 'named', status, scopes }
        : request.method === 'GET'
          ? { service: actionService }
          : request.url.includes('/v1/proxy/')
            ? {
                status: 200,
                headers: { 'content-type': 'application/json' },
                data: { values: [1] },
              }
            : { values: [1] };
      return Promise.resolve(Response.json({ success: true, data }));
    },
  });
  const bind = () =>
    client.bind({
      ...alpha,
      connection: { id: 'connection', service: 'synthetic' },
      requirements: {
        service: 'synthetic',
        requiredScopes: ['read'],
        actions: ['synthetic.list'],
        proxyPaths: ['/items'],
        proxyPostPaths: ['/graphql'],
      },
      signal: new AbortController().signal,
    });
  await expect(bind()).rejects.toThrow('not found');
  expect(requests).toHaveLength(0);
  authorized = true;
  await expect(bind()).rejects.toThrow('connection unavailable');
  status = 'active';
  await expect(bind()).rejects.toThrow('missing scopes');
  scopes = ['read'];
  const provider = await bind();
  await expect(provider.action({ id: 'synthetic.list', input: {} })).rejects.toThrow(
    'operation denied',
  );
  actionService = 'synthetic';
  expect(await provider.action({ id: 'synthetic.list', input: {} })).toEqual({ values: [1] });
  const action = requests.at(-1)!;
  expect(action.headers.get('authorization')).toBe('Bearer backend-runtime');
  expect(action.headers.get('x-oo-connector-alias')).toBe('named');
  expect(await action.json()).toEqual({ input: {} });
  expect(await provider.get({ path: '/items', query: { page: 1 } })).toEqual({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { values: [1] },
  });
  expect(await requests.at(-1)!.json()).toEqual({
    endpoint: '/items',
    method: 'GET',
    query: { page: 1 },
  });
  expect(() => provider.get({ path: 'https://elsewhere.test' })).toThrow('operation denied');
  expect(
    await provider.post({ path: '/graphql', body: { query: 'query { viewer { id } }' } }),
  ).toEqual({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { values: [1] },
  });
  expect(await requests.at(-1)!.json()).toEqual({
    endpoint: '/graphql',
    method: 'POST',
    body: { query: 'query { viewer { id } }' },
  });
  expect(() => provider.post({ path: '/items', body: {} })).toThrow('operation denied');
  expect(() => provider.get({ path: '/graphql' })).toThrow('operation denied');
  expect(() => provider.post({ path: '//evil.test/graphql', body: {} })).toThrow(
    'operation denied',
  );
});
