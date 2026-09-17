import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { githubOAuthJourney } from './github-oauth-journey';
import { startIsolatedApp } from './isolated-app';
import { ownerRegistrationJourney } from './owner-registration-journey';

const app = await startIsolatedApp();
let browser: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
try {
  browser = await virtualPasskeyBrowser({ headless: true });
  const { page } = browser;
  page.on('pageerror', (error) => console.error(error));
  await mkdir('artifacts', { recursive: true });
  await ownerRegistrationJourney({ page, app });

  await page.getByRole('link', { name: 'Providers', exact: true }).click();
  await page.getByRole('heading', { name: 'Providers', exact: true }).waitFor();
  await page.locator('a[href="/providers/github"]').waitFor();
  await page.screenshot({ path: 'artifacts/providers-catalog.png', animations: 'disabled' });
  const providerSearch = page.getByRole('textbox', { name: 'Search providers' });
  // Terms can match different catalog fields and appear in any order.
  await providerSearch.fill('  DEV gith  ');
  await page.locator('a[href="/providers/github"]').waitFor();
  await page.reload();
  assert.equal(await providerSearch.inputValue(), '  DEV gith  ');
  await page.locator('a[href="/providers/github"]').waitFor();
  await providerSearch.fill('github api');
  await page.locator('a[href="/providers/github"]').waitFor();
  await providerSearch.fill('missingproviderzzzz');
  await page.getByText('No providers match your search.', { exact: true }).waitFor();
  // Playwright's route() aborts favicon URLs before user handlers; intercept this image via CDP.
  const iconUrl = 'https://workers.cloudflare.com/favicon.ico';
  const images = await page.context().newCDPSession(page);
  let failImage = false;
  await images.send('Network.setCacheDisabled', { cacheDisabled: true });
  images.on('Fetch.requestPaused', async (event) => {
    if (failImage) {
      await images.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
    } else {
      await images.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }],
        body: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>',
        ).toString('base64'),
      });
    }
  });
  await images.send('Fetch.enable', { patterns: [{ urlPattern: iconUrl }] });
  await providerSearch.fill('mcp infra');
  const cloudflare = page.locator('a[href="/providers/cloudflare_mcp"]');
  const logo = cloudflare.locator('img');
  await logo.waitFor();
  await page.waitForFunction(`() => {
    const image = document.querySelector('a[href="/providers/cloudflare_mcp"] img');
    return image?.complete && image.naturalWidth > 0;
  }`);
  assert.equal(await logo.getAttribute('src'), iconUrl);
  assert.equal(await logo.getAttribute('referrerpolicy'), 'no-referrer');
  failImage = true;
  await page.reload();
  await cloudflare.waitFor();
  await cloudflare.locator('span[aria-hidden="true"]').getByText('C', { exact: true }).waitFor();
  assert.equal(await cloudflare.locator('img').count(), 0);
  await images.send('Fetch.disable');
  await images.send('Network.setCacheDisabled', { cacheDisabled: false });
  // Browser.close owns this CDP session alongside the virtual authenticator.
  await page.getByRole('textbox', { name: 'Search providers' }).fill('GitHub');
  await page.locator('a[href="/providers/github"]').waitFor();
  await page.screenshot({ path: 'artifacts/providers-desktop.png', fullPage: true });
  await page.locator('a[href="/providers/github"]').click();
  await page.getByRole('heading', { name: 'GitHub', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Connection status', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sync pull requests' }).count(), 0);
  await page.getByRole('link', { name: 'Authorization', exact: true }).click();
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  const provider = await (
    await page.request.get(`${app.origin}/api/open-sync/providers/github`)
  ).json();
  const keyLabel = provider.setup.auth.find((method: { type: string }) => method.type === 'api_key')
    .fields[0].label;
  const credential = page.getByLabel(keyLabel, { exact: true });
  await credential.waitFor();
  assert.equal(await credential.getAttribute('type'), 'password');
  await page.screenshot({
    path: 'artifacts/provider-credentials.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .getByRole('navigation', { name: 'Provider sections' })
    .getByRole('link', { name: 'OAuth app', exact: true })
    .click();
  await page.reload();
  await page.getByLabel('Client ID', { exact: true }).fill('browser-test-client');
  await page.getByLabel('Client secret', { exact: true }).fill('browser-test-secret');
  await page.screenshot({
    path: 'artifacts/provider-oauth-setup.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Save OAuth app', exact: true }).click();
  await page.getByRole('button', { name: 'Edit OAuth app', exact: true }).waitFor();
  await app.restartServer();
  await githubOAuthJourney({ page, origin: app.origin });
  await page.getByRole('link', { name: 'All providers', exact: true }).click();
  const notFoundStatus = 404;
  assert.equal(
    (await page.request.get(`${app.origin}/api/open-sync/v1/connections`)).status(),
    notFoundStatus,
  );
  assert.equal(
    (await page.request.get(`${app.origin}/api/open-sync/api/oauth/configs`)).status(),
    notFoundStatus,
  );
  const unauthorizedStatus = 401;
  const forbiddenStatus = 403;
  assert.equal(
    (
      await page.request.post(`${app.origin}/api/open-sync/providers/github/connect`, { data: {} })
    ).status(),
    unauthorizedStatus,
  );
  assert.equal(
    (
      await page.request.post(`${app.origin}/api/syncs/github`, {
        data: { connectionId: `connection_${crypto.randomUUID()}` },
      })
    ).status(),
    unauthorizedStatus,
  );
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
  await page.getByRole('button', { name: 'Add GitHub sync', exact: true }).click();
  await page.getByText('Connect a GitHub account to create this sync.', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/syncs-create.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await mkdir('artifacts', { recursive: true });
  await page.getByRole('link', { name: 'Delivery queue', exact: true }).click();
  await page.getByRole('button', { name: 'Pause delivery', exact: true }).click();
  await page.getByRole('button', { name: 'Resume delivery', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Syncs', exact: true }).click();
  await page.getByRole('button', { name: 'Add sample sync' }).click();
  await page.getByText('succeeded · 12 / 12 records acquired').waitFor();
  await page.screenshot({ path: 'artifacts/dashboard-desktop.png', fullPage: true });
  const saved = (await (
    await page.request.get(`${app.origin}/api/open-sync/sync/installations`)
  ).json()) as {
    installations: { id: string }[];
  };
  const installationId = saved.installations[0]!.id;
  await page.getByRole('link', { name: 'Delivery queue', exact: true }).click();
  await page
    .getByText('12 records waiting · 0 deliveries blocked · Delivery paused', { exact: true })
    .waitFor();
  await page.screenshot({ path: 'artifacts/delivery-paused.png', fullPage: true });
  await page.getByRole('button', { name: 'Resume delivery', exact: true }).click();
  await page.getByText('12 records received', { exact: true }).waitFor();
  await page.getByText('Nothing waiting for delivery', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Syncs', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByText('succeeded · 12 / 12 records acquired').waitFor();
  await page.getByRole('button', { name: 'Reprocess', exact: true }).click();
  await page.getByText('succeeded · 12 / 12 records acquired').waitFor();
  const unauthorized = 401;
  assert.equal((await page.request.post(`${app.origin}/api/sample-syncs`)).status(), unauthorized);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Delivery queue', exact: true }).click();
  await page.getByRole('heading', { name: 'Delivery queue', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Toggle navigation' }).getAttribute('aria-expanded'),
    'false',
  );
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Providers', exact: true }).click();
  await page.getByRole('heading', { name: 'Providers', exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/providers-mobile.png', animations: 'disabled' });
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
    await second.page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
    assert.equal(
      await second.page.getByRole('button', { name: 'Create account with a passkey' }).count(),
      0,
    );
    await second.page.screenshot({ path: 'artifacts/owner-sign-in.png', fullPage: true });
    assert.equal(
      (
        await second.page.request.get(`${app.origin}/api/auth/passkey/generate-register-options`)
      ).status(),
      forbiddenStatus,
    );
    assert.equal(
      (
        await second.page.request.put(`${app.origin}/api/open-sync/providers/github/oauth-client`, {
          headers: { origin: app.origin },
          data: { values: { clientId: 'forbidden', clientSecret: 'must-not-save' } },
        })
      ).status(),
      unauthorizedStatus,
    );
    assert.equal(
      (
        await second.page.request.get(
          `${app.origin}/api/open-sync/sync/installations/${installationId}`,
        )
      ).status(),
      unauthorizedStatus,
    );
  } finally {
    await second.close();
  }
  console.log(
    'Browser journey passed: sections, acquisition, paused delivery, local records, lifecycle controls, CSRF protection and single-owner access.',
  );
} catch (error) {
  console.error(await browser?.page.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  await app.stop();
}
