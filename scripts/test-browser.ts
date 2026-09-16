import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { startIsolatedApp } from './isolated-app';

const app = await startIsolatedApp();
let browser: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
try {
  browser = await virtualPasskeyBrowser({ headless: true });
  const { page } = browser;
  page.on('pageerror', (error) => console.error(error));
  await page.goto(app.origin);
  await page.getByRole('button', { name: 'Create account with a passkey' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/login');
  await page.getByRole('button', { name: 'Create account with a passkey' }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();

  await page.getByRole('link', { name: 'Providers', exact: true }).click();
  await page.getByRole('heading', { name: 'Providers', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/providers');
  assert.equal(
    await page.getByRole('link', { name: 'Providers', exact: true }).getAttribute('aria-current'),
    'page',
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Providers', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Delivery queue', exact: true }).click();
  await page.getByRole('heading', { name: 'Delivery queue', exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Providers', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Syncs', exact: true }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();

  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Delivery queue', exact: true }).click();
  await page.getByRole('heading', { name: 'Delivery queue', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Toggle navigation' }).getAttribute('aria-expanded'),
    'false',
  );
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  const firstSession = (await (
    await page.request.get(`${app.origin}/api/auth/get-session`)
  ).json()) as { user: { id: string } };
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
  assert.equal(await (await page.request.get(`${app.origin}/api/auth/get-session`)).json(), null);
  for (const section of ['/providers', '/syncs', '/delivery']) {
    await page.goto(`${app.origin}${section}`);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/login');
  }
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
  const restored = (await (
    await page.request.get(`${app.origin}/api/auth/get-session`)
  ).json()) as { user: { id: string } };
  assert.equal(restored.user.id, firstSession.user.id);

  const second = await virtualPasskeyBrowser({ headless: true });
  try {
    await second.page.goto(app.origin);
    await second.page.getByRole('button', { name: 'Create account with a passkey' }).click();
    await second.page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
    const another = (await (
      await second.page.request.get(`${app.origin}/api/auth/get-session`)
    ).json()) as { user: { id: string } };
    assert.notEqual(another.user.id, firstSession.user.id);
  } finally {
    await second.close();
  }
  console.log(
    'Browser journey passed: section navigation, deep links, mobile menu, passkey registration and session isolation.',
  );
} catch (error) {
  console.error(await browser?.page.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  await app.stop();
}
