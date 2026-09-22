import { expect, spyOn } from 'bun:test';
import { join } from 'node:path';
import { createConnectorRuntime } from '@oomol-lab/open-connector';
import { createConnectorClient } from '../src/connector/client';
import { alpha, storage } from './support';

/** Only provider HTTP is replaced; the published runtime owns OAuth, credentials and files. */
export async function oauthConnector(input: {
  service: string;
  respond(request: Request): Response | Promise<Response>;
}) {
  const files = storage();
  const network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (...args: Parameters<typeof fetch>) =>
        Promise.resolve(input.respond(new Request(args[0], args[1]))),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const origin = 'http://host/connector';
  const connector = await createConnectorRuntime({
    dataDir: join(files.dir, 'connector'),
    publicOrigin: origin,
    adminToken: 'fixture-admin',
    runtimeToken: 'fixture-runtime',
    encryptionKey: 'fixture-encryption',
  });
  const request = (operation: { path: string; body?: unknown; method?: string; alias?: string }) =>
    connector.fetch(
      new Request(`${origin}${operation.path}`, {
        method: operation.method ?? (operation.body ? 'POST' : 'GET'),
        headers: {
          authorization: 'Bearer fixture-admin',
          'content-type': 'application/json',
          ...(operation.alias ? { 'x-oo-connector-alias': operation.alias } : {}),
        },
        body: operation.body ? JSON.stringify(operation.body) : undefined,
      }),
    );
  const close = async () => {
    try {
      await connector.close();
    } finally {
      network.mockRestore();
      files.close();
    }
  };
  try {
    const configured = await request({
      path: `/api/oauth/configs/${input.service}`,
      method: 'PUT',
      body: { clientId: 'fixture-client', clientSecret: 'fixture-secret' },
    });
    expect(configured.ok).toBe(true);
    const started = await request({
      path: `/v1/connections/${input.service}/connect`,
      body: { returnUri: `${origin}/done` },
    });
    const { data } = (await started.json()) as {
      data: { authorizationUrl: string; connectionRequestId: string };
    };
    const state = new URL(data.authorizationUrl).searchParams.get('state');
    const callback = await request({ path: `/oauth/callback?code=fixture-code&state=${state}` });
    const redirect = 302;
    expect(callback.status).toBe(redirect);
    const completed = await request({
      path: `/v1/connection-requests/${data.connectionRequestId}`,
    });
    const result = (await completed.json()) as { data: { status: string; appId: string } };
    expect(result.data.status).toBe('connected');
    const connection = { id: result.data.appId, service: input.service };
    const metadata = await request({ path: `/v1/connections/by-id/${connection.id}` });
    const alias = ((await metadata.json()) as { data: { alias: string } }).data.alias;
    const client = createConnectorClient({
      fetch: (req) => connector.fetch(req),
      baseUrl: origin,
      adminToken: 'fixture-admin',
      runtimeToken: 'fixture-runtime',
      authorizeConnection: (scope) => Promise.resolve(scope.ownerId === alpha.ownerId),
    });
    return { client, connection, alias, request, connector, files, close };
  } catch (error) {
    await close();
    throw error;
  }
}
