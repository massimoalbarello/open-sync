import { expect, test } from 'bun:test';
import { oauthConnector } from './connector-fixture';
import { alpha } from './support';

test('published Gmail actions and proxies distinguish structured quotas from permission failures', async () => {
  let reason = 'rateLimitExceeded';
  const fixture = await oauthConnector({
    service: 'gmail',
    respond(request) {
      const url = new URL(request.url);
      if (url.hostname === 'oauth2.googleapis.com') {
        return Response.json({
          access_token: 'private-fixture-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      expect(request.headers.get('authorization')).toBe('Bearer private-fixture-token');
      if (url.pathname.endsWith('/profile')) {
        return Response.json({ emailAddress: 'fixture@example.com' });
      }
      expect(url.pathname).toBe('/gmail/v1/users/me/threads');
      return Response.json(
        { error: { message: 'private-fixture-error', errors: [{ reason }] } },
        { status: 403, headers: { 'retry-after': '3600' } },
      );
    },
  });
  try {
    const provider = await fixture.client.bind({
      ...alpha,
      connection: fixture.connection,
      requirements: {
        service: 'gmail',
        actions: ['gmail.list_threads'],
        proxyPaths: ['/users/me/threads'],
      },
      signal: new AbortController().signal,
    });
    for (const classification of [
      { reason: 'rateLimitExceeded', status: 429, code: 'rate_limited' },
      { reason: 'userRateLimitExceeded', status: 429, code: 'rate_limited' },
      { reason: 'dailyLimitExceeded', status: 429, code: 'rate_limited' },
      { reason: 'quotaExceeded', status: 429, code: 'rate_limited' },
      { reason: 'insufficientPermissions', status: 403, code: 'authorization_failed' },
      { reason: 'unknown', status: 403, code: 'authorization_failed' },
    ]) {
      reason = classification.reason;
      for (const execute of [
        () => provider.action({ id: 'gmail.list_threads', input: {} }),
        () => provider.get({ path: '/users/me/threads' }),
      ]) {
        await expect(execute()).rejects.toMatchObject({
          status: classification.status,
          diagnostics: {
            connectorStatus: classification.status,
            connectorErrorCode: classification.code,
            providerStatus: 403,
          },
        });
      }
    }
  } finally {
    await fixture.close();
  }
});
