import { expect, test } from 'bun:test';
import { oauthConnector } from './connector-fixture';
import { alpha } from './support';

// Exercise the published connector, including OAuth, proxy routing and failures.
test('Google Calendar OAuth and proxy preserve native change-feed parameters and cursor expiry status', async () => {
  const f = await oauthConnector({
    service: 'googlecalendar',
    respond(request) {
      const url = new URL(request.url);
      if (url.hostname === 'oauth2.googleapis.com') {
        return Response.json({
          access_token: 'fixture-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      if (url.pathname === '/oauth2/v3/userinfo') {
        return Response.json({ sub: 'fixture-account', email: 'fixture@example.com' });
      }
      expect(request.headers.get('authorization')).toBe('Bearer fixture-token');
      if (url.pathname === '/calendar/v3/calendars/primary') {
        return Response.json({ id: 'fixture@example.com' });
      }
      if (url.pathname === '/calendar/v3/users/me/calendarList') {
        expect(url.searchParams.get('maxResults')).toBe('1');
        expect(url.searchParams.get('showHidden')).toBe('true');
        expect(url.searchParams.get('minAccessRole')).toBe('reader');
        return Response.json({ items: [{ id: 'fixture@example.com' }] });
      }
      expect(url.pathname).toBe('/calendar/v3/calendars/primary/events');
      expect(url.searchParams.get('singleEvents')).toBe('false');
      expect(url.searchParams.get('showDeleted')).toBe('true');
      expect(url.searchParams.get('syncToken')).toBe('saved-token');
      return Response.json(
        { error: { code: 410, message: 'Sync token expired' } },
        { status: 410 },
      );
    },
  });
  try {
    expect(new URL(f.authorizationUrl).searchParams.get('scope')?.split(' ')).toContain(
      'https://www.googleapis.com/auth/calendar.readonly',
    );
    const provider = await f.client.bind({
      ...alpha,
      connection: f.connection,
      requirements: {
        service: 'googlecalendar',
        actions: [],
        proxyPaths: ['/calendars/primary', '/users/me/calendarList', '/calendars/:id/events'],
      },
      signal: new AbortController().signal,
    });
    expect(await provider.get({ path: '/calendars/primary' })).toMatchObject({
      status: 200,
      body: { id: 'fixture@example.com' },
    });
    expect(
      await provider.get({
        path: '/users/me/calendarList',
        query: { maxResults: 1, minAccessRole: 'reader', showHidden: true },
      }),
    ).toMatchObject({ status: 200, body: { items: [{ id: 'fixture@example.com' }] } });
    const promise = provider.get({
      path: '/calendars/primary/events',
      query: { syncToken: 'saved-token', singleEvents: false, showDeleted: true },
    });
    await expect(promise).rejects.toMatchObject({
      code: 'connector_request_failed',
      diagnostics: {
        service: 'googlecalendar',
        operation: '/calendars/primary/events',
        providerStatus: 410,
      },
    });
  } finally {
    await f.close();
  }
});
