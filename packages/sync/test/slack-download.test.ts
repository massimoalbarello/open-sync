import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { oauthConnector } from './connector-fixture';
import { alpha } from './support';

test('published Slack downloads keep credentials inside Connector and preserve quota failures', async () => {
  let limited = true;
  const fixture = await oauthConnector({
    service: 'slack',
    respond(request) {
      const url = new URL(request.url);
      if (url.pathname.includes('oauth.')) {
        return Response.json({
          ok: true,
          access_token: 'private-slack-token',
          token_type: 'user',
          scope: 'channels:read,channels:history,groups:read,groups:history,files:read',
          authed_user: {
            id: 'U1',
            access_token: 'private-slack-token',
            token_type: 'user',
            scope: 'channels:read,channels:history,groups:read,groups:history,files:read',
          },
          team: { id: 'T1' },
        });
      }
      expect(request.headers.get('authorization')).toBe('Bearer private-slack-token');
      if (url.pathname === '/api/auth.test') {
        return Response.json({
          ok: true,
          team_id: 'T1',
          user_id: 'U1',
          user: 'alice',
          team: 'Example',
          url: 'https://example.slack.com/',
        });
      }
      if (url.pathname === '/api/files.info') {
        expect(url.searchParams.get('file')).toBe('F1');
        return Response.json({
          ok: true,
          file: {
            id: 'F1',
            name: 'file.bin',
            mimetype: 'application/octet-stream',
            url_private_download: 'https://files.slack.com/private-file',
          },
        });
      }
      expect(url.href).toBe('https://files.slack.com/private-file');
      const rateLimited = 429;
      return limited
        ? new Response(null, { status: rateLimited })
        : new Response('private attachment', {
            headers: { 'content-type': 'application/octet-stream' },
          });
    },
  });
  try {
    const provider = await fixture.client.bind({
      ...alpha,
      connection: fixture.connection,
      requirements: { service: 'slack', actions: ['slack.download_file'] },
      signal: new AbortController().signal,
    });
    const input = { id: 'slack.download_file', input: { fileId: 'F1' }, fileField: 'file' };
    await expect(provider.download!(input)).rejects.toMatchObject({
      status: 429,
      diagnostics: { providerStatus: 429, connectorErrorCode: 'rate_limited' },
    });
    limited = false;
    expect(await new Response(await provider.download!(input)).text()).toBe('private attachment');
    expect(await readdir(join(fixture.files.dir, 'connector', 'files'))).toEqual([]);
  } finally {
    await fixture.close();
  }
});
