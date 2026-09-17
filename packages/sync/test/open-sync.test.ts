import { expect, test } from 'bun:test';
import { createOpenSync } from '../src/open-sync';
import { fixture, storage } from './support';

const alice = { actorId: 'alice', ownerId: 'alice' };
const http = {
  redirect: 302,
  unauthorized: 401,
  ok: 200,
  notFound: 404,
  badRequest: 400,
  unavailable: 503,
};
const bob = { actorId: 'bob', ownerId: 'bob' };

test('one public runtime owns provider configuration, consent, HTTP authorization and restart', async () => {
  const files = storage();
  const publicUrl = 'http://host/embedded';
  const options = {
    dataDirectory: files.dir,
    publicUrl,
    definitions: [],
    destinationTypes: {},
    authorize: (request: Request) => (request.headers.has('test-owner') ? alice : null),
    authorizationRedirect: ({ service, outcome }: { service: string; outcome: string }) =>
      `http://host/ui/${service}?authorization=${outcome}`,
    canConfigureProviders: (scope: typeof alice) =>
      Promise.resolve(scope.ownerId === alice.ownerId),
  };
  let runtime = await createOpenSync(options);
  const request = (path: string) =>
    runtime.fetch(new Request(`${publicUrl}${path}`, { headers: { 'test-owner': 'alice' } }));
  try {
    expect((await runtime.fetch(new Request(`${publicUrl}/providers`))).status).toBe(
      http.unauthorized,
    );
    expect((await request('/providers')).status).toBe(http.ok);
    for (const path of ['/v1/connections', '/v1/proxy/github', '/api/oauth/configs', '/api/apps']) {
      expect((await request(path)).status).toBe(http.notFound);
    }
    await expect(
      runtime.providers.configure({ ...bob, service: 'github', values: {} }),
    ).rejects.toThrow('forbidden');
    await runtime.providers.configure({
      ...alice,
      service: 'github',
      values: { clientId: 'test-client', clientSecret: 'test-secret' },
    });
    const status = await runtime.providers.status({ ...alice, service: 'github' });
    expect(status.setup.oauthClient).toMatchObject({
      configured: true,
      expectedRedirectUri: `${publicUrl}/oauth/callback`,
    });
    expect(JSON.stringify(status)).not.toContain('test-secret');
    const authorization = new URL(
      (
        await runtime.providers.start({
          ...alice,
          service: 'github',
          authorizationOptionIds: ['read:user'],
        })
      ).authorizationUrl,
    );
    expect(authorization.origin).toBe('https://github.com');
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${publicUrl}/oauth/callback`);
    const response = await request(
      `/oauth/callback?error=access_denied&state=${authorization.searchParams.get('state')}`,
    );
    const returned = new URL(response.headers.get('location')!);
    expect(returned.pathname).toMatch(/^\/embedded\/providers\/github\/return\/connection_/);
    expect('complete' in runtime.providers).toBe(false);
    expect('tick' in runtime).toBe(false);
    const completed = await request(returned.pathname.slice('/embedded'.length));
    expect(completed.status).toBe(http.redirect);
    expect(completed.headers.get('location')).toBe('http://host/ui/github?authorization=failed');
    expect(await runtime.providers.connections(alice)).toEqual([]);
    await runtime.close();
    expect((await request('/providers')).status).toBe(http.unavailable);
    await expect(runtime.providers.connections(alice)).rejects.toThrow();
    await runtime.close();
    runtime = await createOpenSync(options);
    expect(
      (await runtime.providers.status({ ...alice, service: 'github' })).setup.oauthClient
        ?.configured,
    ).toBe(true);
  } finally {
    await runtime.close();
    files.close();
  }
});

test('failed engine initialization releases the embedded provider runtime for the next start', async () => {
  const files = storage();
  const options = {
    dataDirectory: files.dir,
    publicUrl: 'http://host/sync',
    definitions: [fixture, fixture],
    destinationTypes: {},
    authorize: () => alice,
    canConfigureProviders: () => Promise.resolve(true),
  };
  try {
    await expect(createOpenSync(options)).rejects.toThrow();
    const runtime = await createOpenSync({ ...options, definitions: [] });
    try {
      expect((await runtime.providers.catalog(alice)).length).toBeGreaterThan(0);
    } finally {
      await runtime.close();
    }
  } finally {
    files.close();
  }
});
