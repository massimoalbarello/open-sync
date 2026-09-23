import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

export async function providerSetupJourney(input: {
  page: Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
  origin: string;
}) {
  const { page, origin } = input;
  await page.goto(`${origin}/providers/gmail`);
  await page.getByRole('button', { name: 'Connect another account', exact: true }).waitFor();
  assert.equal(await page.getByText('Authorization callback URL', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Edit OAuth app', exact: true }).click();
  await page.getByText('Authorization callback URL', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByText('Authorization callback URL', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Connect another account', exact: true }).click();
  await page.getByRole('heading', { name: 'Example consent boundary' }).waitFor();
  const state = new URL(page.url()).searchParams.get('state');
  assert.ok(state);
  await page.goto(
    `${origin}/api/open-sync/oauth/callback?code=work-account-code&state=${encodeURIComponent(state)}`,
  );
  await page.getByText('work@example.com', { exact: true }).waitFor();
  assert.equal(await page.getByText('Connected', { exact: true }).count(), 2);
  await page.screenshot({
    path: 'artifacts/provider-accounts.png',
    fullPage: true,
    animations: 'disabled',
  });
  const accountStatus = await (
    await page.request.get(`${origin}/api/open-sync/providers/gmail`)
  ).json();
  const work = accountStatus.connections.find(
    (entry: { account: string }) => entry.account === 'work@example.com',
  );
  const disambiguatorLength = 8;
  const providerPattern = '**/api/open-sync/providers/gmail';
  await page.route(providerPattern, async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({
      response,
      json: {
        ...status,
        connections: status.connections.map((entry: { account: string }) => ({
          ...entry,
          account: 'Shared display name',
        })),
      },
    });
  });
  try {
    await page.goto(`${origin}/syncs/new?source=gmail.threads`);
    await page.getByLabel('Account', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create sync', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Select a connected account for this source.' })
      .waitFor();
    await page.getByLabel('Account', { exact: true }).click();
    await page.getByRole('option').first().waitFor();
    const labels = await page.getByRole('option').allTextContents();
    assert.equal(labels.length, 2);
    assert.equal(new Set(labels).size, 2);
    await page
      .getByRole('option', {
        name: `Shared display name · ${work.id.slice(-disambiguatorLength)}`,
        exact: true,
      })
      .click();
    await page.getByLabel('Account', { exact: true }).click();
    await page.getByRole('option').first().waitFor();
    await page.screenshot({
      path: 'artifacts/sync-account-collisions.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Account', { exact: true }).click();
    await page.getByRole('option').first().waitFor();
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await page.screenshot({
      path: 'artifacts/sync-account-collisions-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page
      .getByRole('option', {
        name: `Shared display name · ${work.id.slice(-disambiguatorLength)}`,
        exact: true,
      })
      .click();
    await page.setViewportSize({ width: 1280, height: 720 });
  } finally {
    await page.unroute(providerPattern);
  }
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.waitForURL(/\/syncs\/sync_/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('link', { name: 'Polling history', exact: true }).click();
  await page.getByRole('cell', { name: 'Completed', exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page
    .locator('main header')
    .getByText('Account: work@example.com', { exact: true })
    .waitFor();
  await page.goto(`${origin}/syncs`);
  await page.getByText('Account: work@example.com', { exact: true }).waitFor();
  await page.screenshot({
    path: 'artifacts/sync-accounts.png',
    fullPage: true,
    animations: 'disabled',
  });
  const sync = await (await page.request.get(`${origin}/api/open-sync/sync/syncs/${id}`)).json();
  const status = await (await page.request.get(`${origin}/api/open-sync/providers/gmail`)).json();
  assert.equal(
    sync.connection.id,
    status.connections.find((entry: { account: string }) => entry.account === 'work@example.com')
      .id,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/providers/gmail`);
  await page.getByRole('button', { name: 'Connect another account', exact: true }).waitFor();
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await page.screenshot({
    path: 'artifacts/provider-accounts-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  console.log(
    'Provider setup journey passed: callback visibility, multiple accounts, and account selection during sync creation.',
  );
}
