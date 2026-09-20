// Test composition root: only GitHub's external HTTP boundary is replaced. The real host,
// passkey verification, Connector, sync worker and SQLite stores run unchanged.
import { pull } from '../apps/web/backend/test/github-sync/fixture';

const fetchNetwork = globalThis.fetch;
let oauthToken = 0;
const recordCount = 65;
const discoveryPageSize = 10;
const idWidth = 3;
const records = Array.from(
  { length: recordCount },
  // biome-ignore lint/complexity/useMaxParams: Array.from supplies the item and index.
  (_, index) => pull(String(index).padStart(idWidth, '0')),
);
globalThis.fetch = Object.assign(
  async (...args: Parameters<typeof fetch>) => {
    const request =
      args[0] instanceof Request
        ? new Request(args[0], args[1])
        : new Request(String(args[0]), args[1]);
    const url = new URL(request.url);
    if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') {
      return Response.json({
        access_token: `browser-test-oauth-token-${++oauthToken}`,
        token_type: 'bearer',
        scope: 'read:user repo',
      });
    }
    if (url.hostname !== 'api.github.com') {
      return fetchNetwork(...args);
    }
    const authorization = request.headers.get('authorization') ?? '';
    if (
      authorization.includes('invalid-test-token') ||
      (authorization.includes('browser-test-oauth-token-') &&
        !authorization.endsWith(`browser-test-oauth-token-${oauthToken}`))
    ) {
      return Response.json({ message: 'Bad credentials' }, { status: 401 });
    }
    if (url.pathname === '/user') {
      return Response.json({ id: 42, node_id: 'test-user', login: 'octocat' });
    }
    if (url.pathname !== '/graphql') {
      throw new Error(`Unexpected GitHub request: ${url.pathname}`);
    }
    const { query, variables } = (await request.json()) as {
      query: string;
      variables: { after?: string; id?: string };
    };
    if (query.includes('SyncIdentity')) {
      return Response.json({ data: { viewer: { id: 'test-user' } } });
    }
    if (query.includes('SyncPullSummary')) {
      return Response.json({
        data: { node: records.find((record) => record.id === variables.id) },
      });
    }
    if (query.includes('SyncDiscover')) {
      const start = variables.after
        ? records.findIndex((record) => `cursor-${record.id}` === variables.after) + 1
        : 0;
      return Response.json({
        data: {
          viewer: {
            pullRequests: {
              edges: records.slice(start, start + discoveryPageSize).map((record) => ({
                cursor: `cursor-${record.id}`,
                node: { id: record.id, updatedAt: record.updatedAt },
              })),
              pageInfo: { hasNextPage: start + discoveryPageSize < records.length },
            },
          },
        },
      });
    }
    throw new Error('Unexpected GitHub query');
  },
  { preconnect: fetchNetwork.preconnect },
);
await import('../apps/web/backend/src/main');
