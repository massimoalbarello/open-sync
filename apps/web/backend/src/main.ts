import { join } from 'node:path';
import { createConnectorRuntime } from '@oomol-lab/open-connector';
import { createSyncRuntime } from '@open-sync/core';
import { createConnectorClient } from '@open-sync/core/connector';
import { createApp } from '#backend/app.ts';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { loadAuthSecret } from '#backend/lib/auth/auth-secret.ts';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { connectorManagement } from '#backend/lib/connector/client.ts';
import { loadConnectorKey } from '#backend/lib/connector/encryption-key.ts';
import { loadEnv } from '#backend/lib/env.ts';
import { FrontendAssetsRepository } from '#backend/repositories/frontend-assets/repository.ts';
import { SqliteProviders } from '#backend/repositories/providers/sqlite.ts';
import { SqliteReceiver } from '#backend/repositories/receiver/sqlite.ts';
import { FrontendAssetsService } from '#backend/services/frontend-assets/service.ts';
import { githubPullRequests } from '#backend/services/github-sync/definition.ts';
import { GithubSyncService } from '#backend/services/github-sync/service.ts';
import { ProviderService } from '#backend/services/providers/service.ts';
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
let sync: ReturnType<typeof createSyncRuntime> | undefined;
let connector: Awaited<ReturnType<typeof createConnectorRuntime>> | undefined;
try {
  await runMigrations({ db: database });
  const adminToken = crypto.randomUUID();
  const runtimeToken = crypto.randomUUID();
  const connectorUrl = new URL('/connector', env.BASE_URL).href;
  const runtime = await createConnectorRuntime({
    dataDir: join(env.DATA_FOLDER, 'connector'),
    publicOrigin: connectorUrl,
    encryptionKey: await loadConnectorKey(env.DATA_FOLDER),
    adminToken,
    runtimeToken,
  });
  connector = runtime;
  const connectorFetch = (request: Request) => runtime.fetch(request);
  const management = connectorManagement({
    fetch: connectorFetch,
    baseUrl: connectorUrl,
    adminToken,
    runtimeToken,
  });
  const providers = new SqliteProviders(database);
  const receiver = new ReceiverService(new SqliteReceiver(database));
  sync = createSyncRuntime({
    databasePath: join(env.DATA_FOLDER, 'sync.db'),
    definitions: [sampleSync, githubPullRequests],
    connector: createConnectorClient({
      fetch: connectorFetch,
      baseUrl: connectorUrl,
      adminToken,
      runtimeToken,
      authorizeConnection: (input) =>
        providers.owns({ ...input, connectorId: input.connection.id }),
    }),
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
    auth: createAuth({
      database,
      baseUrl: env.BASE_URL,
      nibrunHostname: env.NIBRUN_HOSTNAME,
      secret: secret.value,
    }),
    frontend: new FrontendAssetsService(new FrontendAssetsRepository()),
    sync: sync.api,
    receiver,
    samples: new SampleSyncService(sync.api),
    providers: new ProviderService({
      repository: providers,
      connector: management,
      publicUrl: env.BASE_URL,
    }),
    githubSyncs: new GithubSyncService({ repository: providers, sync: sync.api }),
    connectorFetch,
    origins: [
      ...new Set([
        env.BASE_URL.origin,
        ...(env.NIBRUN_HOSTNAME ? [`https://${env.NIBRUN_HOSTNAME}`] : []),
      ]),
    ],
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
    await connector?.close();
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
  await connector?.close();
  await database.close();
  throw error;
}
