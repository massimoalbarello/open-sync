import { mkdir } from 'node:fs/promises';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import {
  brandFallbackJourney,
  configureGithub,
  ownerRegistrationJourney,
  sessionJourney,
} from './authorization-journey';
import { startIsolatedApp } from './isolated-app';
import { exampleSyncsJourney, githubSyncJourney, syncLifecycleJourney } from './sync-journey';

const interactionTimeoutMs = 30_000;
const app = await startIsolatedApp({
  serverCommand: [
    'bun',
    'run',
    '--no-orphans',
    '--define',
    'PUBLIC_FRONTEND_DIR_NAME=".frontend-served-by-vite"',
    '--define',
    'DB_MIGRATIONS_DIR_NAME="migrations"',
    '../../scripts/test-browser-server.ts',
  ],
});
let browser: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
try {
  browser = await virtualPasskeyBrowser({ headless: true, timezoneId: 'Europe/London' });
  const { page } = browser;
  page.setDefaultTimeout(interactionTimeoutMs);
  await mkdir('artifacts', { recursive: true });
  const input = { page, origin: app.origin, app };
  await brandFallbackJourney(input);
  await ownerRegistrationJourney(input);
  await configureGithub(input);
  const syncId = await githubSyncJourney(input);
  await exampleSyncsJourney(input);
  await syncLifecycleJourney({ ...input, syncId });
  await sessionJourney(input);
  console.log(
    'Browser journey passed: real passkeys, provider authorization, deliverable inspection, pagination, resync and removal.',
  );
} catch (error) {
  console.error(error);
  console.error(
    await browser?.page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => 'Page unavailable'),
  );
  throw error;
} finally {
  await browser?.close();
  await app.stop();
}
