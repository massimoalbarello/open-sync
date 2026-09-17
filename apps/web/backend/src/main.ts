import { createOpenSync, type OpenSyncRuntime } from '@open-sync/core';
import { createApp } from '#backend/app.ts';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { loadAuthSecret } from '#backend/lib/auth/auth-secret.ts';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { loadEnv } from '#backend/lib/env.ts';
import { FrontendAssetsRepository } from '#backend/repositories/frontend-assets/repository.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';
import { authorizeSyncRequest } from '#backend/routes/sync-authorization.ts';
import { FrontendAssetsService } from '#backend/services/frontend-assets/service.ts';
import { githubPullRequests } from '#backend/services/github-sync/definition.ts';
import { GithubSyncService } from '#backend/services/github-sync/service.ts';
import { loggingDestination } from '#backend/services/receiver/logging-destination.ts';
import { ReceiverService } from '#backend/services/receiver/service.ts';
import { sampleSync } from '#backend/services/sample-sync/definition.ts';
import { SampleSyncService } from '#backend/services/sample-sync/service.ts';

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
  sync = await createOpenSync({
    dataDirectory: env.DATA_FOLDER,
    // Keep the existing public callback URL configured in provider OAuth applications.
    publicUrl: new URL('/connector', env.BASE_URL).href,
    authorize: (request) => authorizeSyncRequest({ auth, origins, request }),
    canConfigureProviders: (scope) => Promise.resolve(scope.actorId === scope.ownerId),
    authorizationReturnUrl: ({ service, id }) =>
      new URL(`/api/providers/${encodeURIComponent(service)}/return/${id}`, env.BASE_URL).href,
    definitions: [sampleSync, githubPullRequests],
    destinationTypes: {
      local: receiver.destination(),
      'local-log': loggingDestination({
        destination: receiver.destination(),
        log: (delivery) => console.log(JSON.stringify({ event: 'sync.deliverable', ...delivery })),
      }),
    },
    onEvent: (event) => console.log(JSON.stringify({ event: 'sync.status', ...event })),
  });
  const app = createApp({
    auth,
    frontend: new FrontendAssetsService(new FrontendAssetsRepository()),
    sync: sync.api,
    receiver,
    samples: new SampleSyncService(sync.api),
    providers: sync.providers,
    githubSyncs: new GithubSyncService({ providers: sync.providers, sync: sync.api }),
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
