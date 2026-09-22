import { expect, spyOn, test } from 'bun:test';
import { createConnectorClient } from '../src/connector/client';
import { connectorFailure } from '../src/connector/failure';
import type { SyncEvent } from '../src/execution/diagnostics';
import type { SyncRegistration } from '../src/models/definition';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, fixture, page, storage } from './support';

const connection = { id: 'connection', service: 'slack' };
const requirements = { service: 'slack', actions: [], proxyPaths: ['/conversations.replies'] };
const rateLimited = 429;
const unavailable = 503;
const secret = 'private-token-and-provider-payload';

test.each(['first-provider', 'second-provider'])(
  '%s uses Connector HTTP semantics, not upstream status or provider identity',
  (service) => {
    const forbidden = 403;
    const permission = connectorFailure({
      service,
      operation: 'list',
      kind: 'rejected',
      response: new Response(null, { status: forbidden }),
      body: { errorCode: 'authorization_failed', data: { status: forbidden } },
    });
    expect(permission.status).toBe(forbidden);
    const limited = connectorFailure({
      service,
      operation: 'list',
      kind: 'rejected',
      response: new Response(null, { status: rateLimited }),
      body: {
        errorCode: 'rate_limited',
        message: secret,
        data: {
          status: forbidden,
        },
      },
    });
    expect(limited).toMatchObject({
      status: rateLimited,
      diagnostics: { providerStatus: forbidden },
    });
    expect(JSON.stringify(limited)).not.toContain(secret);
  },
);

test('Connector HTTP status remains authoritative over conflicting error metadata', () => {
  const failure = connectorFailure({
    service: 'provider',
    operation: 'list',
    kind: 'rejected',
    response: new Response(null, { status: unavailable }),
    body: { errorCode: 'rate_limited', data: { status: 403 } },
  });
  expect(failure).toMatchObject({
    status: unavailable,
    diagnostics: { connectorErrorCode: 'rate_limited', providerStatus: 403 },
  });
});

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

test('connector failures use engine backoff despite timing headers and retain only safe scoped diagnostics', async () => {
  const files = storage();
  const events: SyncEvent[] = [];
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  let retryAfter = '120';
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
        { status: rateLimited, headers: { 'retry-after': retryAfter, 'set-cookie': secret } },
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
          httpStatus: rateLimited,
          failureCount: 1,
          retryAfterMs: 30_000,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
    const scope = { ...alpha, id: installation.id };
    const firstDelay = 30_000;
    const secondDelay = 60_000;
    expect(engine.api.installation(scope)).toMatchObject({
      checkpoint: 0,
      nextDueAt: now + firstDelay,
    });
    now += firstDelay;
    const providerDelay = 120_000;
    retryAfter = new Date(now + providerDelay).toUTCString();
    await engine.tick();
    expect(engine.api.installation(scope)).toMatchObject({
      checkpoint: 0,
      nextDueAt: now + secondDelay,
    });
    expect(events.at(-1)?.fields).toMatchObject({
      httpStatus: rateLimited,
      failureCount: 2,
      retryAfterMs: secondDelay,
    });
    expect(JSON.stringify(events)).not.toContain(secret);
  } finally {
    await engine.close();
    clock.mockRestore();
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

test('caller aborts are not recast as connector failures', async () => {
  const abort = new AbortController();
  const provider = await client(() =>
    Promise.reject(new Error('Unexpected provider operation')),
  ).bind({ ...alpha, connection, requirements, signal: abort.signal });
  abort.abort('paused');
  await expect(provider.get({ path: '/conversations.replies' })).rejects.toBe('paused');
});
