import { runOpenSyncCron } from '@context-use/open-sync/cron';

if (await runOpenSyncCron()) {
  process.exit(0);
}

const { startServer } = await import('./main');
await startServer();
