// Test composition root: real passkeys, Connector, workers and storage with provider HTTP fixtures
// and one explicit destination failure. Application data is created through authenticated APIs.
import { join } from 'node:path';
import { createApp } from '../apps/web/backend/src/app';
import { createSqliteDatabase } from '../apps/web/backend/src/db/client';
import { runMigrations } from '../apps/web/backend/src/db/migrate';
import { loadAuthSecret } from '../apps/web/backend/src/lib/auth/auth-secret';
import { createAuth } from '../apps/web/backend/src/lib/auth/better-auth';
import { loadEnv } from '../apps/web/backend/src/lib/env';
import { FrontendAssetsRepository } from '../apps/web/backend/src/repositories/frontend-assets/repository';
import { SqliteReceiver } from '../apps/web/backend/src/repositories/receiver/sqlite';
import { authorizeSyncRequest } from '../apps/web/backend/src/routes/sync-authorization';
import { DashboardService } from '../apps/web/backend/src/services/dashboard/service';
import { FrontendAssetsService } from '../apps/web/backend/src/services/frontend-assets/service';
import { ReceiverService } from '../apps/web/backend/src/services/receiver/service';
import { syncDefinitions } from '../apps/web/backend/src/sync-definitions';
import { pull } from '../apps/web/backend/test/github-sync/fixture';
import { localDestination } from '../examples/integrations/src/destinations/local/definition';
import { granolaClientRegistration } from '../examples/integrations/src/providers/granola';
import { createOpenSync, type OpenSyncRuntime } from '../packages/sync/src/open-sync';
import { exampleProviderResponse, githubFixtureRecordCount } from './example-provider-fixtures';

const fetchNetwork = globalThis.fetch;
let oauthToken = 0;
const accountTokens = new Map<string, string>();
// Small provider pages exercise deliverable pagination with a bounded fixture.
const discoveryPageSize = 1;
const idWidth = 3;
const records = Array.from(
  { length: githubFixtureRecordCount },
  // biome-ignore lint/complexity/useMaxParams: Array.from supplies the item and index.
  (_, index) => pull(String(index).padStart(idWidth, '0')),
);
globalThis.fetch = Object.assign(
  async (...args: Parameters<typeof fetch>) => {
    const request = fetchRequest(args);
    const url = new URL(request.url);
    const exampleResponse = await exampleProviderResponse(request);
    if (exampleResponse) {
      return exampleResponse;
    }
    if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') {
      const code = new URLSearchParams(await request.text()).get('code')!;
      const account = code.split('/')[0]!;
      const token = `browser-test-oauth-token-${++oauthToken}`;
      // Reconnecting rotates only this fixture account's token, preserving independent syncs.
      accountTokens.set(account, token);
      return Response.json({
        access_token: token,
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
        ![...accountTokens.values()].some((token) => authorization.endsWith(token)))
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
await startFixtureHost();

function fetchRequest(args: Parameters<typeof fetch>) {
  return args[0] instanceof Request
    ? new Request(args[0], args[1])
    : new Request(String(args[0]), args[1]);
}

async function startFixtureHost() {
  const env = loadEnv();
  const secret = await loadAuthSecret({
    dataFolder: env.DATA_FOLDER,
    environmentSecret: env.BETTER_AUTH_SECRET,
  });
  const database = await createSqliteDatabase({ dataFolder: env.DATA_FOLDER });
  let sync: OpenSyncRuntime | undefined;
  try {
    await runMigrations({ db: database });
    const auth = createAuth({
      database,
      baseUrl: env.BASE_URL,
      nibrunHostname: env.NIBRUN_HOSTNAME,
      secret: secret.value,
    });
    const origins = [
      ...new Set([
        env.BASE_URL.origin,
        ...(env.NIBRUN_HOSTNAME ? [`https://${env.NIBRUN_HOSTNAME}`] : []),
      ]),
    ];
    const receiver = new ReceiverService(
      await SqliteReceiver.open({
        db: database,
        assetDirectory: join(env.DATA_FOLDER, 'received-assets'),
      }),
    );
    const local = localDestination({ accept: (input) => receiver.accept(input) });
    let blockedOnce = false;
    let dashboard: DashboardService;
    sync = await createOpenSync({
      dataDirectory: env.DATA_FOLDER,
      publicUrl: new URL('/api/open-sync', env.BASE_URL).href,
      authorize: (request) => authorizeSyncRequest({ auth, origins, request }),
      canConfigureProviders: (scope) => Promise.resolve(scope.actorId === scope.ownerId),
      authorizationRedirect: ({ service, outcome }) =>
        `/providers/${encodeURIComponent(service)}${outcome === 'failed' ? '?authorization=failed' : ''}`,
      definitions: [
        ...syncDefinitions,
        {
          definition: {
            id: 'fixture.polls',
            name: 'Polling fixture',
            configSchema: { type: 'object', additionalProperties: false },
            checkpointSchema: { type: 'null' },
            initialCheckpoint: null,
            kinds: { note: { type: 'object' } },
          },
          load: () => ({
            step() {
              return Promise.resolve({
                records: [
                  {
                    operation: 'upsert',
                    id: 'one',
                    kind: 'note',
                    data: { text: 'A stable fixture record' },
                  },
                ],
                checkpoint: null,
                complete: true,
              });
            },
          }),
        },
      ],
      oauthClientRegistrations: { granola: granolaClientRegistration({ fetch }) },
      onProviderConnected: (input) => dashboard.connectWaiting(input),
      destinationTypes: {
        local: {
          ...local,
          async deliver(input) {
            if (!blockedOnce && input.deliverable.definition === 'github.pull-requests') {
              blockedOnce = true;
              return { status: 'rejected', code: 'browser_fixture_blocked' };
            }
            return await local.deliver(input);
          },
        },
      },
      onEvent: (event) => console.log(JSON.stringify({ event: 'sync.status', ...event })),
    });
    dashboard = new DashboardService(sync);
    const app = createApp({
      dashboard,
      auth,
      frontend: new FrontendAssetsService(new FrontendAssetsRepository()),
      receiver,
      syncFetch: sync.fetch,
      origins,
    }).listen({ port: env.PORT, hostname: '0.0.0.0' });
    sync.start();
    console.log(`Open Sync listening on http://0.0.0.0:${app.server!.port}`);
    let stopping = false;
    const stop = async () => {
      if (stopping) {
        return;
      }
      stopping = true;
      await app.stop();
      await sync?.close();
      await database.close();
    };
    process.once('SIGTERM', () => {
      void stop();
    });
    process.once('SIGINT', () => {
      void stop();
    });
  } catch (error) {
    await sync?.close();
    await database.close();
    throw error;
  }
}
