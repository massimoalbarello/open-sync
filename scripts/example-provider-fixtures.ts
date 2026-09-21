// Provider HTTP boundaries only: authentication, OAuth state, MCP and storage stay real.
let granolaRegistrationAttempts = 0;
export async function exampleProviderResponse(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.hostname === 'oauth2.googleapis.com') {
    const fields = new URLSearchParams(await request.text());
    const work = fields.get('code') === 'work-account-code';
    return Response.json({
      access_token: work ? 'gmail-work-fixture-token' : 'gmail-fixture-token',
      refresh_token: 'gmail-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.modify',
    });
  }
  if (url.hostname === 'gmail.googleapis.com') {
    return gmailResponse(request);
  }
  if (url.hostname === 'slack.com') {
    return slackResponse(url);
  }
  if (url.hostname === 'mcp-auth.granola.ai') {
    return await granolaOAuthResponse(request);
  }
  if (url.hostname === 'mcp.granola.ai') {
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return Response.json({
        resource: 'https://mcp.granola.ai/mcp',
        authorization_servers: ['https://mcp-auth.granola.ai'],
      });
    }
    return await granolaResponse(request);
  }
  if (url.hostname === 'receiver.example') {
    return new Response(null, { status: 401 });
  }
}

function gmailResponse(request: Request) {
  const url = new URL(request.url);
  const millisecondsPerSecond = 1000;
  if (url.pathname.endsWith('/profile')) {
    return Response.json({
      emailAddress: request.headers.get('authorization')?.includes('gmail-work-fixture-token')
        ? 'work@example.com'
        : 'alice@example.com',
      messagesTotal: 1,
      threadsTotal: 1,
      historyId: '1',
    });
  }
  if (url.pathname.endsWith('/threads')) {
    const query = url.searchParams.get('q') ?? '';
    const oldest = Number(query.match(/after:(\d+)/)?.[1] ?? 0);
    const latest = Number(query.match(/before:(\d+)/)?.[1] ?? Infinity);
    const lastActivity = Date.parse('2020-01-02T12:00:00.000Z') / millisecondsPerSecond;
    return Response.json({
      threads: lastActivity > oldest && lastActivity < latest ? [{ id: 'thread-1' }] : [],
    });
  }
  if (url.pathname.endsWith('/threads/thread-1')) {
    return Response.json({
      id: 'thread-1',
      messages: [
        gmailMessage({ id: 'email-1', date: '2020-01-01T12:00:00.000Z', text: 'Meet at noon?' }),
        gmailMessage({
          id: 'email-2',
          date: '2020-01-02T12:00:00.000Z',
          text: 'Yes, see you there!',
        }),
      ],
    });
  }
  throw new Error(`Unexpected Gmail fixture path: ${url.pathname}`);
}

function gmailMessage(input: { id: string; date: string; text: string }) {
  return {
    id: input.id,
    threadId: 'thread-1',
    labelIds: ['INBOX'],
    internalDate: String(Date.parse(input.date)),
    snippet: input.text,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Subject', value: 'Lunch' },
        { name: 'From', value: 'sam@example.com' },
        { name: 'To', value: 'alice@example.com' },
      ],
      body: { data: Buffer.from(input.text).toString('base64url') },
    },
  };
}

function slackResponse(url: URL) {
  const scopes = 'channels:read,channels:history,groups:read,groups:history';
  if (url.pathname.includes('oauth.')) {
    return Response.json({
      ok: true,
      access_token: 'slack-fixture-token',
      token_type: 'user',
      scope: scopes,
      authed_user: {
        id: 'U1',
        access_token: 'slack-fixture-token',
        token_type: 'user',
        scope: scopes,
      },
      team: { id: 'T1', name: 'Example' },
    });
  }
  const body = (() => {
    switch (url.pathname) {
      case '/api/auth.test':
        return {
          team_id: 'T1',
          user_id: 'U1',
          user: 'alice',
          team: 'Example',
          url: 'https://example.slack.com/',
        };
      case '/api/users.conversations':
        return {
          channels: [{ id: 'C1', name: 'general' }],
          response_metadata: { next_cursor: '' },
        };
      case '/api/conversations.history':
        return {
          messages: [
            { ts: '1577880000.000001', text: 'Lunch?', user: 'U1', reply_count: 2 },
          ].filter(
            (message) =>
              Number(message.ts) >= Number(url.searchParams.get('oldest') ?? 0) &&
              Number(message.ts) <= Number(url.searchParams.get('latest') ?? Infinity),
          ),
          has_more: false,
          response_metadata: { next_cursor: '' },
        };
      case '/api/conversations.replies':
        return slackReplies(url);
      default:
        throw new Error(`Unexpected Slack fixture path: ${url.pathname}`);
    }
  })();
  return Response.json({ ok: true, ...body }, { headers: { 'x-oauth-scopes': scopes } });
}

function slackReplies(url: URL) {
  const root = '1577880000.000001';
  if (url.searchParams.get('oldest') || url.searchParams.get('latest')) {
    throw new Error('Thread messages must not be clipped to the discovery window');
  }
  return url.searchParams.get('cursor')
    ? {
        messages: [
          { ts: '1789819202.000001', thread_ts: root, text: 'See you there!', user: 'U1' },
        ],
        has_more: false,
      }
    : {
        messages: [
          { ts: root, thread_ts: root, text: 'Lunch?', user: 'U1', reply_count: 2 },
          { ts: '1577880001.000001', thread_ts: root, text: 'At noon?', user: 'U2' },
        ],
        has_more: true,
        response_metadata: { next_cursor: 'replies-2' },
      };
}

async function granolaResponse(request: Request) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405 });
  }
  const body = (await request.json()) as {
    id?: string | number;
    method: string;
    params?: { protocolVersion?: string; name?: string };
  };
  if (body.id === undefined) {
    return new Response(null, { status: 202 });
  }
  let result: unknown;
  switch (body.method) {
    case 'initialize':
      result = {
        protocolVersion: body.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'granola-fixture', version: '1' },
      };
      break;
    case 'tools/list':
      result = {
        tools: ['list_meetings', 'get_meetings'].map((name) => ({
          name,
          inputSchema: { type: 'object' },
        })),
      };
      break;
    case 'tools/call':
      if (!['list_meetings', 'get_meetings'].includes(body.params?.name ?? '')) {
        throw new Error('Unexpected Granola tool');
      }
      result = {
        content: [
          {
            type: 'text',
            text: '<meetings_data count="1"><meeting id="meeting-1" title="Planning" date="2026-09-19"><known_participants>Alice, Sam</known_participants><summary>## Decisions\nShip it.</summary></meeting></meetings_data>',
          },
        ],
      };
      break;
    default:
      throw new Error(`Unexpected MCP method: ${body.method}`);
  }
  return Response.json({ jsonrpc: '2.0', id: body.id, result });
}

async function granolaOAuthResponse(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return Response.json({
      issuer: 'https://mcp-auth.granola.ai',
      authorization_endpoint: 'https://mcp-auth.granola.ai/oauth2/authorize',
      token_endpoint: 'https://mcp-auth.granola.ai/oauth2/token',
      registration_endpoint: 'https://mcp-auth.granola.ai/oauth2/register',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  }
  if (url.pathname === '/oauth2/register') {
    const metadata = (await request.json()) as Record<string, unknown>;
    if (
      request.method !== 'POST' ||
      metadata.token_endpoint_auth_method !== 'none' ||
      !Array.isArray(metadata.redirect_uris) ||
      metadata.redirect_uris.length !== 1
    ) {
      throw new Error('Invalid Granola dynamic registration');
    }
    if (++granolaRegistrationAttempts === 1) {
      return Response.json(
        { error: 'temporarily_unavailable', detail: 'private-upstream-detail' },
        { status: 503 },
      );
    }
    return Response.json(
      { ...metadata, client_id: 'dynamically-registered-granola' },
      { status: 201 },
    );
  }
  return Response.json(
    url.pathname.endsWith('/userinfo')
      ? { sub: 'granola-alice', email: 'alice@example.com', name: 'Alice' }
      : {
          access_token: 'granola-fixture-token',
          refresh_token: 'granola-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email offline_access',
        },
  );
}
