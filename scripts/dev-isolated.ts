import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { startIsolatedApp } from './isolated-app';

const app = await startIsolatedApp();
let browser: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
const stop = () => app.child.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  browser = await virtualPasskeyBrowser({ headless: false });
  await browser.page.goto(app.origin);
  if (Bun.argv.includes('--seed')) {
    await browser.page.getByRole('button', { name: 'Create account' }).click();
    await browser.page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
  }
  console.log(`Isolated application: ${app.origin} (data: ${app.dataFolder})`);
  await app.child.exited;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  await browser?.close();
  await app.stop();
}
