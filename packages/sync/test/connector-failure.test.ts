import { expect, test } from 'bun:test';
import { createConnectorClient } from '../src/connector/client';
import type { SyncEvent } from '../src/execution/diagnostics';
import type { SyncRegistration } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, fixture, page, storage } from './support';

const connection = { id: 'connection', service: 'slack' };
const requirements = { service: 'slack', actions: [], proxyPaths: ['/conversations.replies'] };
const rateLimited = 429;
const unavailable = 503;
const secret = 'private-token-and-provider-payload';

function client(response: () => Promise<Response>) {
  return createConnectorClient({
    baseUrl: 'http://connector',
    adminToken: secret,
    runtimeToken: secret,
    authorizeConnection: () => Promise.resolve(true),
    fetch: (request) =>
      request.url.includes('/by-id/')
        ? Promise.resolve(
            Response.json({
              success: true,
              data: { ...connection, alias: secret, status: 'active' },
            }),
          )
        : response(),
  });
}

test('connector failure diagnostics reach scoped runtime logs without credentials or upstream payloads', async () => {
  const files = storage();
  const events: SyncEvent[] = [];
  const connector = client(() =>
    Promise.resolve(
      Response.json(
        {
          success: false,
          errorCode: 'rate_limited',
          message: secret,
          data: { status: rateLimited, details: { secret } },
          meta: { secret },
        },
        { status: rateLimited, headers: { 'retry-after': '120', 'set-cookie': secret } },
      ),
    ),
  );
  const registration: SyncRegistration = {
    ...fixture,
    definition: { ...fixture.definition, provider: requirements },
    load: () => ({
      async *run({ provider }) {
        await provider.get({ path: '/conversations.replies', query: { token: secret } });
        yield { ...page, complete: true };
      },
    }),
  };
  const engine = createSyncRuntime({
    databasePath: files.path,
    definitions: [registration],
    destinationTypes: { local: accepted },
    connector,
    onEvent: (event) => events.push(event),
  });
  try {
    const destination = engine.api.createDestination({ ...alpha, type: 'local', config: {} });
    const installation = await engine.api.createInstallation({
      ...alpha,
      connection,
      definition: registration.definition,
      destinationId: destination.id,
      config: { count: 1 },
    });
    await engine.tick();
    expect(events).toEqual([
      {
        code: 'connector_request_failed',
        ownerId: alpha.ownerId,
        installationId: installation.id,
        fields: {
          service: 'slack',
          operation: '/conversations.replies',
          failureKind: 'rejected',
          connectorStatus: rateLimited,
          connectorErrorCode: 'rate_limited',
          providerStatus: rateLimited,
          failureCount: 1,
          retryAfterMs: 120_000,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(engine.api.installation({ ...alpha, id: installation.id }).checkpoint).toBe(0);
  } finally {
    await engine.close();
    files.close();
  }
});

test.each([
  {
    name: 'network failure',
    response: () => Promise.reject(new Error(secret)),
    fields: { failureKind: 'transport' },
  },
  {
    name: 'HTML error',
    response: () => Promise.resolve(new Response(secret, { status: unavailable })),
    fields: { failureKind: 'invalid_response', connectorStatus: unavailable },
  },
  {
    name: 'null JSON',
    response: () => Promise.resolve(Response.json(null)),
    fields: { failureKind: 'invalid_response', connectorStatus: 200 },
  },
  {
    name: 'invalid error metadata',
    response: () =>
      Promise.resolve(
        Response.json({
          success: false,
          errorCode: secret,
          data: { status: secret },
          message: secret,
        }),
      ),
    fields: { failureKind: 'rejected', connectorStatus: 200 },
  },
])('$name retains safe context', async ({ response, fields }) => {
  const provider = await client(response).bind({
    ...alpha,
    connection,
    requirements,
    signal: new AbortController().signal,
  });
  await expect(provider.get({ path: '/conversations.replies' })).rejects.toMatchObject({
    code: 'connector_request_failed',
    message: 'connector request failed',
    diagnostics: { service: 'slack', operation: '/conversations.replies', ...fields },
  });
});

test.each(['-1', 'nonsense', 'Infinity', '1.5', '99999999999999999', '9999-12-31'])(
  'invalid Retry-After %s is ignored',
  async (retryAfter) => {
    const provider = await client(() =>
      Promise.resolve(
        Response.json(
          { success: false },
          {
            status: rateLimited,
            headers: { 'retry-after': retryAfter },
          },
        ),
      ),
    ).bind({ ...alpha, connection, requirements, signal: new AbortController().signal });
    await expect(provider.get({ path: '/conversations.replies' })).rejects.toMatchObject({
      retryAfterMs: undefined,
    });
  },
);

test('HTTP-date cooldowns are preserved and caller aborts are not recast as connector failures', async () => {
  const minute = 60_000;
  const future = Date.now() + minute;
  const abort = new AbortController();
  const provider = await client(() =>
    Promise.resolve(
      Response.json(
        { success: false },
        {
          status: rateLimited,
          headers: { 'retry-after': new Date(future).toUTCString() },
        },
      ),
    ),
  ).bind({ ...alpha, connection, requirements, signal: abort.signal });
  const error = await provider
    .get({ path: '/conversations.replies' })
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: 'connector_request_failed' });
  const tolerance = 2000;
  expect((error as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(minute - tolerance);
  expect((error as { retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(minute);
  abort.abort('paused');
  await expect(provider.get({ path: '/conversations.replies' })).rejects.toBe('paused');
});
