import { createOpenSync, type OpenSyncRuntime } from '@context-use/open-sync';
import { httpDestination } from '@open-sync/examples/destinations/http';
import { createApp } from '#backend/app.ts';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { loadAuthSecret } from '#backend/lib/auth/auth-secret.ts';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { destinationCredentials } from '#backend/lib/destination-credentials.ts';
import { loadEnv } from '#backend/lib/env.ts';
import { FrontendAssetsRepository } from '#backend/repositories/frontend-assets/repository.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import { DashboardService } from '#backend/services/dashboard/service.ts';
import { FrontendAssetsService } from '#backend/services/frontend-assets/service.ts';
import { ReceiverService } from '#backend/services/receiver/service.ts';
import { syncDefinitions } from '#backend/sync-definitions.ts';

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
  const receiver = new ReceiverService(new SqliteReceiver(database));
  const credentials = destinationCredentials(secret.value);
  let dashboard: DashboardService;
  sync = await createOpenSync({
    dataDirectory: env.DATA_FOLDER,
    publicUrl: new URL('/api/open-sync', env.BASE_URL).href,
    authorize: (request) => authorizeSyncRequest({ auth, origins, request }),
    canConfigureProviders: (scope) => Promise.resolve(scope.actorId === scope.ownerId),
    authorizationRedirect: ({ service, outcome }) =>
      `/providers/${encodeURIComponent(service)}${outcome === 'failed' ? '?authorization=failed' : ''}`,
    definitions: syncDefinitions,
    onProviderConnected: (input) => dashboard.connectWaiting(input),
    destinationTypes: {
      local: receiver.destination(),
      http: httpDestination({ resolveApiKey: credentials.open }),
    },
    onEvent: (event) => console.log(JSON.stringify({ event: 'sync.status', ...event })),
  });
  dashboard = new DashboardService({ ...sync, sealDestinationKey: credentials.seal });
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
