import { expect, test } from 'bun:test';
import { oauthConnector } from './connector-fixture';
import { alpha } from './support';

test('published YouTube OAuth requests identity scopes and exposes only protocol metadata for rejected pages', async () => {
  const fixture = await oauthConnector({
    service: 'youtube',
    respond(request) {
      const url = new URL(request.url);
      if (url.hostname === 'oauth2.googleapis.com') {
        return Response.json({
          access_token: 'fixture-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      expect(request.headers.get('authorization')).toBe('Bearer fixture-token');
      if (url.pathname === '/oauth2/v3/userinfo') {
        return Response.json({ sub: 'fixture-account', email: 'fixture@example.com' });
      }
      expect(url.pathname).toBe('/youtube/v3/playlistItems');
      expect(url.searchParams.get('pageToken')).toBe('expired');
      return Response.json(
        { error: { errors: [{ reason: 'invalidPageToken' }] } },
        { status: 400 },
      );
    },
  });
  try {
    const consent = new URL(fixture.authorizationUrl);
    expect(consent.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining([
        'https://www.googleapis.com/auth/youtube.readonly',
        'openid',
        'email',
        'profile',
      ]),
    );
    expect(consent.searchParams.get('access_type')).toBe('offline');
    const provider = await fixture.client.bind({
      ...alpha,
      connection: fixture.connection,
      requirements: { service: 'youtube', actions: [], proxyPaths: ['/youtube/v3/playlistItems'] },
      signal: new AbortController().signal,
    });
    await expect(
      provider.get({ path: '/youtube/v3/playlistItems', query: { pageToken: 'expired' } }),
    ).rejects.toMatchObject({
      code: 'connector_request_failed',
      status: 400,
      diagnostics: {
        service: 'youtube',
        operation: '/youtube/v3/playlistItems',
        providerStatus: 400,
      },
    });
  } finally {
    await fixture.close();
  }
});
