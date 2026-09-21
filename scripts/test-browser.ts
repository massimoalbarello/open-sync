import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { exampleSyncsJourney } from './example-syncs-journey';
import {
  githubOAuthJourney,
  githubOAuthReconnectJourney,
  githubOAuthSuccessJourney,
} from './github-oauth-journey';
import { startIsolatedApp } from './isolated-app';
import { ownerRegistrationJourney } from './owner-registration-journey';

const fixtureRecordCount = 100;
const sourceCount = 4;
const drainTimeoutMs = 120_000;
const interactionTimeoutMs = 30_000;
const wideViewport = { width: 1920, height: 1080 };

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
  browser = await virtualPasskeyBrowser({ headless: true });
  const { page } = browser;
  page.setDefaultTimeout(interactionTimeoutMs);
  await mkdir('artifacts', { recursive: true });
  await ownerRegistrationJourney({ page, app });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.getByRole('link', { name: 'Providers', exact: true }).click();
  const cards = page.getByRole('list', { name: 'Providers', exact: true }).getByRole('listitem');
  const providerPageSize = 30;
  await cards.nth(providerPageSize - 1).waitFor();
  assert.equal(await cards.count(), providerPageSize);
  await page.screenshot({ path: 'artifacts/providers-desktop.png', animations: 'disabled' });
  await cards.last().scrollIntoViewIfNeeded();
  await cards.nth(providerPageSize).waitFor();
  assert.ok(
    requests.some((url) => url.includes('/providers/catalog?') && url.includes('offset=30')),
  );
  assert.ok(!requests.some((url) => new URL(url).pathname === '/api/open-sync/providers'));
  const search = page.getByRole('textbox', { name: 'Search providers' });
  await search.fill('  DEV gith  ');
  await page.locator('a[href="/providers/github"]').waitFor();
  assert.equal(await cards.count(), 1);
  await page.reload();
  assert.equal(await search.inputValue(), '  DEV gith  ');
  await search.fill('missingproviderzzzz');
  await page.getByText('No providers match your search.', { exact: true }).waitFor();
  await search.fill('github api');
  await page.locator('a[href="/providers/github"]').click();
  await page.getByLabel('Client ID', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'OAuth', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  assert.equal(await page.getByRole('navigation', { name: 'Provider sections' }).count(), 0);
  await page.getByRole('button', { name: 'OAuth', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Connect account', exact: true }).isEnabled(),
    false,
  );
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

  await page.getByRole('link', { name: 'Sources', exact: true }).click();
  await page.getByRole('heading', { name: 'GitHub pull requests', exact: true }).waitFor();
  assert.equal(await page.locator('main li').count(), sourceCount);
  assert.equal(await page.getByText('Configuration schema', { exact: true }).count(), 0);
  assert.ok(
    (
      await page
        .locator('li')
        .filter({ has: page.getByRole('heading', { name: 'GitHub pull requests' }) })
        .getByRole('link', { name: 'Create sync' })
        .getAttribute('href')
    )?.startsWith('/syncs/new?source=github.pull-requests'),
  );
  await page.screenshot({
    path: 'artifacts/sources-catalog.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Destinations', exact: true }).click();
  await page.getByRole('heading', { name: 'Local SQLite', exact: true }).waitFor();
  assert.equal(await page.locator('main li').count(), 2);
  assert.equal(await page.getByRole('button', { name: 'Add destination' }).count(), 0);
  await page.screenshot({
    path: 'artifacts/destinations.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Syncs', exact: true }).click();
  await page.getByRole('link', { name: 'Create sync', exact: true }).click();
  await page.getByLabel('Source', { exact: true }).click();
  await page.getByRole('option', { name: 'GitHub pull requests', exact: true }).click();
  assert.equal(await page.locator('main textarea').count(), 0);
  assert.equal(await page.getByLabel('Account', { exact: true }).count(), 0);
  await page.screenshot({
    path: 'artifacts/syncs-create.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page
    .getByText('Your sync is saved. Connect your account to start syncing.', { exact: true })
    .waitFor();
  const syncId = new URL(page.url()).searchParams.get('syncId')!;
  await app.restartServer();
  await page.reload();
  await page
    .getByText('Your sync is saved. Connect your account to start syncing.', { exact: true })
    .waitFor();
  const settings = await page.request.patch(`${app.origin}/api/receiver/settings`, {
    headers: { origin: app.origin },
    data: { paused: true },
  });
  assert.ok(settings.ok());
  assert.equal(await page.getByRole('button', { name: 'API key', exact: true }).count(), 0);
  await page.goto(`${app.origin}/providers/github`);
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  const status = await (
    await page.request.get(`${app.origin}/api/open-sync/providers/github`)
  ).json();
  const keyLabel = status.setup.auth.find((method: { type: string }) => method.type === 'api_key')
    .fields[0].label;
  const credential = page.getByLabel(keyLabel, { exact: true });
  assert.equal(await credential.getAttribute('type'), 'password');
  await credential.fill('invalid-test-token');
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not connect.' }).waitFor();
  await credential.fill('browser-test-github-token');
  await page.screenshot({
    path: 'artifacts/provider-api-key.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  const originalKeySync = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/installations/${syncId}`)
  ).json();
  assert.equal(originalKeySync.connection, undefined);
  assert.equal(originalKeySync.enabled, false);
  const keyAccounts = await (
    await page.request.get(`${app.origin}/api/open-sync/providers/github`)
  ).json();
  const keyConnection = keyAccounts.connections.find(
    (connection: { authType: string }) => connection.authType === 'api_key',
  );
  await page.goto(`${app.origin}/providers/github?connectionId=${keyConnection.id}`);
  await page.getByRole('heading', { name: /^Reconnect / }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'OAuth', exact: true }).count(), 0);
  await page.getByLabel(keyLabel, { exact: true }).fill('browser-test-replacement-key');
  const keyResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/providers/github/credentials') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Reconnect account', exact: true }).click();
  assert.ok((await keyResponse).ok());
  const refreshedKeySync = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/installations/${syncId}`)
  ).json();
  assert.deepEqual(refreshedKeySync.connection, originalKeySync.connection);
  assert.equal(refreshedKeySync.sourceId, originalKeySync.sourceId);
  await githubOAuthSuccessJourney({ page, origin: app.origin });
  await page.goto(`${app.origin}/syncs/${syncId}`);
  await page.getByText('Completed → Local SQLite', { exact: true }).waitFor();
  assert.equal(await page.getByText('Record schemas', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Source configuration', { exact: true }).count(), 0);
  await page.screenshot({
    path: 'artifacts/sync-detail.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Polling history', exact: true }).click();
  await page.getByRole('cell', { name: 'Completed', exact: true }).waitFor();
  await page.getByRole('columnheader', { name: 'Records processed', exact: true }).waitFor();
  assert.equal(await page.getByRole('columnheader', { name: 'Pages', exact: true }).count(), 0);
  await page.getByText('2 attempts', { exact: true }).click();
  await page.getByText(/Continuing from checkpoint/).waitFor();
  const polls = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/installations/${syncId}/polls`)
  ).json();
  assert.equal(polls.polls.length, 1);
  assert.equal(polls.polls[0].recordsProcessed, fixtureRecordCount);
  assert.equal(polls.polls[0].recordsChanged, fixtureRecordCount);
  assert.equal(polls.polls[0].attempts[0].recordsProcessed, 0);
  await page.screenshot({
    path: 'artifacts/polling-history.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Queue', exact: true }).click();
  await page
    .getByText(`${fixtureRecordCount} records waiting · 0 deliveries blocked · Delivery paused`, {
      exact: true,
    })
    .waitFor();
  const deliveries = page.getByRole('list', { name: 'Pending deliveries' }).getByRole('listitem');
  const dataPageSize = 50;
  await deliveries.nth(dataPageSize - 1).waitFor();
  assert.equal(await deliveries.count(), dataPageSize);
  await deliveries.last().scrollIntoViewIfNeeded();
  await deliveries.nth(fixtureRecordCount - 1).waitFor();
  assert.equal(await deliveries.count(), fixtureRecordCount);
  await page.screenshot({ path: 'artifacts/queue.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Resume delivery', exact: true }).click();
  await page
    .getByText(`${fixtureRecordCount} records received`, { exact: true })
    .waitFor({ timeout: drainTimeoutMs });
  await page.getByText('Nothing waiting for delivery', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  const records = page.getByRole('list', { name: 'Received records' }).getByRole('listitem');
  await records.nth(dataPageSize - 1).waitFor();
  assert.equal(await records.count(), dataPageSize);
  await records.last().scrollIntoViewIfNeeded();
  await records.nth(fixtureRecordCount - 1).waitFor();
  assert.equal(await records.count(), fixtureRecordCount);
  await page.getByText('pull-request · 000', { exact: true }).click();
  await page.locator('pre').getByText('"title": "PR 000"', { exact: false }).waitFor();
  await page.screenshot({ path: 'artifacts/received-records.png', animations: 'disabled' });
  await page.getByRole('link', { name: 'Syncs', exact: true }).click();
  requests.length = 0;
  await page.waitForResponse('**/api/open-sync/sync/installations');
  assert.ok(!requests.some((url) => new URL(url).pathname === '/api/open-sync/sync/deliveries'));
  // An authorized account skips setup and reuses the managed local destination.
  await page.getByRole('link', { name: 'Create sync', exact: true }).click();
  await page.getByLabel('Source', { exact: true }).click();
  await page.getByRole('option', { name: 'GitHub pull requests', exact: true }).click();
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.getByRole('navigation', { name: 'Sync sections' }).waitFor();
  assert.ok(new URL(page.url()).pathname.startsWith('/syncs/sync_'));
  const destinations = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/destinations`)
  ).json();
  assert.equal(destinations.destinations.length, 1);
  // Exercise the successful OAuth callback against a saved, unbound installation as well.
  const definitions = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/definitions`)
  ).json();
  const pendingOAuth = await page.request.post(`${app.origin}/api/open-sync/sync/installations`, {
    headers: { origin: app.origin },
    data: {
      definition: definitions.definitions[0],
      destinationId: destinations.destinations[0].id,
      config: {},
      enabled: false,
    },
  });
  assert.ok(pendingOAuth.ok());
  const oauthSync = await pendingOAuth.json();
  await githubOAuthSuccessJourney({ page, origin: app.origin });
  const activated = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/installations/${oauthSync.id}`)
  ).json();
  assert.equal(activated.enabled, true);
  assert.ok(activated.connection);
  await githubOAuthReconnectJourney({
    page,
    origin: app.origin,
    connectionId: activated.connection.id,
  });
  const reconnected = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/installations/${oauthSync.id}`)
  ).json();
  assert.deepEqual(reconnected.connection, activated.connection);
  assert.equal(reconnected.sourceId, activated.sourceId);
  const accounts = await (
    await page.request.get(`${app.origin}/api/open-sync/providers/github`)
  ).json();
  const expectedConnections = 3;
  assert.equal(accounts.connections.length, expectedConnections);
  await page.goto(`${app.origin}/syncs/${oauthSync.id}`);
  await page.getByText('Completed → Local SQLite', { exact: true }).waitFor();
  const beforeRun = await (
    await page.request.get(`${app.origin}/api/open-sync/sync/installations/${oauthSync.id}`)
  ).json();
  const nextRun = page.waitForResponse(async (response) => {
    if (!response.url().endsWith(`/sync/installations/${oauthSync.id}`) || !response.ok()) {
      return false;
    }
    const installation = await response.json();
    return (
      installation.status === 'succeeded' &&
      installation.checkpointRevision > beforeRun.checkpointRevision
    );
  });
  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  await nextRun;
  await page.setViewportSize(wideViewport);
  await page.getByRole('link', { name: 'Providers', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search providers' }).fill('github');
  await page.locator('a[href="/providers/github"]').waitFor();
  const layout = await page.locator('main').boundingBox();
  assert.ok(layout && layout.x + layout.width === wideViewport.width);
  await page.screenshot({ path: 'artifacts/providers-wide.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Workspace' });
  assert.deepEqual(await navigation.getByRole('link').allTextContents(), [
    'Providers',
    'Syncs',
    'Records',
    'Queue',
    'Sources',
    'Destinations',
  ]);
  await page.getByRole('link', { name: 'Queue', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Toggle navigation' }).getAttribute('aria-expanded'),
    'false',
  );
  await page.screenshot({ path: 'artifacts/queue-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
  const unauthorized = 401;
  assert.equal(
    (
      await page.request.post(`${app.origin}/api/dashboard/syncs`, {
        data: { source: 'github.pull-requests', destination: { type: 'local', input: {} } },
        headers: { origin: app.origin },
      })
    ).status(),
    unauthorized,
  );
  assert.equal(
    (await page.request.get(`${app.origin}/api/open-sync/providers/catalog`)).status(),
    unauthorized,
  );
  assert.equal(
    (await page.request.get(`${app.origin}/api/open-sync/sync/installations/${syncId}`)).status(),
    unauthorized,
  );
  for (const section of [
    '/providers',
    '/sources',
    '/destinations',
    '/syncs',
    '/records',
    '/delivery',
  ]) {
    await page.goto(`${app.origin}${section}`);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
  }
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
  await exampleSyncsJourney({ page, origin: app.origin });
  console.log(
    'Browser journey passed: paginated catalogs, provider setup, deferred authorization, GitHub syncs, infinite records and queue, responsive layout and real passkeys.',
  );
} catch (error) {
  console.error(await browser?.page.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  await app.stop();
}
