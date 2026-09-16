import { createApp } from '#backend/app.ts';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { loadAuthSecret } from '#backend/lib/auth/auth-secret.ts';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { loadEnv } from '#backend/lib/env.ts';
import { FrontendAssetsRepository } from '#backend/repositories/frontend-assets/repository.ts';
import { NotesRepository } from '#backend/repositories/notes/repository.ts';
import { FrontendAssetsService } from '#backend/services/frontend-assets/service.ts';
import { NotesService } from '#backend/services/notes/service.ts';

const env = loadEnv();
const secret = await loadAuthSecret({
  dataFolder: env.DATA_FOLDER,
  environmentSecret: env.BETTER_AUTH_SECRET,
});
const database = await createSqliteDatabase({ dataFolder: env.DATA_FOLDER });
try {
  await runMigrations({ db: database });
  const app = createApp({
    auth: createAuth({
      database,
      baseUrl: env.BASE_URL,
      nibrunHostname: env.NIBRUN_HOSTNAME,
      secret: secret.value,
    }),
    notes: new NotesService(new NotesRepository(database)),
    frontend: new FrontendAssetsService(new FrontendAssetsRepository()),
    origin: env.BASE_URL.origin,
  }).listen({ port: env.PORT, hostname: '0.0.0.0' });
  console.log(`Application listening on http://0.0.0.0:${app.server!.port}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await app.stop();
    await database.close();
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
} catch (error) {
  await database.close();
  throw error;
}
