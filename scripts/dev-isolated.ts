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
    await browser.page.getByRole('button', { name: 'Create account with a passkey' }).click();
    await browser.page
      .getByLabel('What’s on your mind?')
      .fill('A fresh beginning. Make this application your own.');
    await browser.page.getByRole('button', { name: 'Save note', exact: true }).click();
    await browser.page
      .getByText('A fresh beginning. Make this application your own.', { exact: true })
      .waitFor();
  }
  console.log(`Isolated application: ${app.origin} (data: ${app.dataFolder})`);
  await app.child.exited;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  await browser?.close();
  await app.stop();
}
