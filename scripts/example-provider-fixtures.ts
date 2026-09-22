import { readFileSync } from 'node:fs';

// Provider HTTP boundaries only: authentication, OAuth state, MCP and storage stay real.
let granolaRegistrationAttempts = 0;
let granolaListingAttempts = 0;
let slackReplyAttempts = 0;
export const granolaFixtureMeetingCount = 23;
const granolaMeetingIds = [...Array(granolaFixtureMeetingCount).keys()].map(
  (index) => `meeting-${index + 1}`,
);
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
  if (url.pathname.endsWith('/messages/email-1/attachments/fixture-attachment')) {
    return Response.json({ data: Buffer.from('external attachment').toString('base64url') });
  }
  if (url.pathname.endsWith('/messages/email-1/attachments/oversized-attachment')) {
    // Exercise the published Connector proxy's 20 MiB response guard without allocating the payload.
    const responseBytes = 22_020_096;
    return Response.json({ data: '' }, { headers: { 'content-length': String(responseBytes) } });
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
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Lunch' },
        { name: 'From', value: 'sam@example.com' },
        { name: 'To', value: 'alice@example.com' },
      ],
      parts: [
        ...(input.id === 'email-2' ? previewAttachments() : []),
        {
          partId: '0',
          mimeType: 'text/plain',
          body: { data: Buffer.from(input.text).toString('base64url') },
        },
        ...(input.id === 'email-1'
          ? [
              {
                partId: '1',
                filename: 'attachment.bin',
                mimeType: 'application/octet-stream',
                body: { data: Buffer.from('inline attachment').toString('base64url') },
              },
              {
                partId: '2',
                filename: 'attachment.bin',
                mimeType: 'application/octet-stream',
                body: { attachmentId: 'fixture-attachment' },
              },
              {
                partId: '3',
                filename: 'oversized.bin',
                mimeType: 'application/octet-stream',
                body: { attachmentId: 'oversized-attachment' },
              },
            ]
          : []),
      ],
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
  if (url.pathname === '/api/conversations.replies' && url.searchParams.has('cursor')) {
    const injectedFailures = 2;
    const ok = 200;
    const unavailable = 503;
    if (++slackReplyAttempts <= injectedFailures) {
      return Response.json(
        {
          ok: false,
          error: slackReplyAttempts === 1 ? 'ratelimited' : 'private-upstream-detail',
          detail: 'private-upstream-detail',
        },
        {
          status: slackReplyAttempts === 1 ? ok : unavailable,
          headers: { 'retry-after': '60' },
        },
      );
    }
    const permissionFailure = 4;
    if (slackReplyAttempts === permissionFailure) {
      return Response.json({
        ok: false,
        error: 'missing_scope',
        detail: 'private-upstream-detail',
      });
    }
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
    params?: {
      protocolVersion?: string;
      name?: string;
      arguments?: { time_range?: string; meeting_ids?: string[] };
    };
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
      result = granolaToolResponse(body.params ?? {});
      break;
    default:
      throw new Error(`Unexpected MCP method: ${body.method}`);
  }
  return Response.json({ jsonrpc: '2.0', id: body.id, result });
}

function granolaToolResponse(params: {
  name?: string;
  arguments?: { time_range?: string; meeting_ids?: string[] };
}) {
  if (!['list_meetings', 'get_meetings'].includes(params.name ?? '')) {
    throw new Error('Unexpected Granola tool');
  }
  const listing = params.name === 'list_meetings';
  const ids = listing ? granolaMeetingIds : params.arguments?.meeting_ids;
  const detailRequestLimit = 10;
  if (
    !ids ||
    (!listing &&
      (ids.length > detailRequestLimit || ids.some((id) => !granolaMeetingIds.includes(id))))
  ) {
    throw new Error('Invalid Granola detail request');
  }
  if (listing && params.arguments?.time_range !== 'last_30_days') {
    throw new Error('Unexpected Granola listing window');
  }
  // Exercise the real connector's rejection of explicit MCP listing truncation.
  const truncated = listing && ++granolaListingAttempts === 1;
  return {
    content: [
      {
        type: 'text',
        text: `<meetings_data count="${ids.length}"${truncated ? ' has_more="true"' : ''}>${ids.map((id) => `<meeting id="${id}" title="Planning ${id}" date="2026-09-19"><known_participants>Alice, Sam</known_participants><summary>## Decisions\nShip it.</summary></meeting>`).join('')}</meetings_data>`,
      },
    ],
  };
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

function previewAttachments() {
  return [
    ['brief.pdf', 'application/pdf'],
    ['brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['forecast.xls', 'application/vnd.ms-excel'],
    ['forecast.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['photo.jpg', 'image/jpeg'],
    ['illustration.svg', 'image/svg+xml'],
    ['clip.mp4', 'video/mp4'],
  ].map(([name, mimeType]) => ({
    partId: name,
    filename: name,
    mimeType,
    body: {
      data: readFileSync(new URL(`./fixtures/previews/${name}`, import.meta.url)).toString(
        'base64url',
      ),
    },
  }));
}
