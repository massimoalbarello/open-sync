import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

export async function githubOAuthJourney(input: {
  page: Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
  origin: string;
}) {
  const { page } = input;
  // Stop at GitHub's network boundary. OAuth state/redirects and the app session remain real.
  await page.route('https://github.com/login/oauth/authorize**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Consent boundary</h1>' }),
  );
  await page.goto(`${input.origin}/providers/github`);
  await page.getByRole('button', { name: 'OAuth', exact: true }).click();
  const connect = page.getByRole('button', { name: 'Connect account' });
  await connect.waitFor();
  assert.equal(await connect.isEnabled(), true);
  await page.screenshot({ path: 'artifacts/providers-configured.png', fullPage: true });
  await connect.click();
  await page.getByRole('heading', { name: 'Consent boundary' }).waitFor();
  const authorization = new URL(page.url());
  assert.equal(authorization.searchParams.get('client_id'), 'browser-test-client');
  assert.equal(
    authorization.searchParams.get('redirect_uri'),
    `${input.origin}/api/open-sync/oauth/callback`,
  );
  assert.equal(authorization.searchParams.get('scope'), 'read:user repo');
  assert.ok(authorization.searchParams.get('state'));
  await page.goto(
    `${input.origin}/api/open-sync/oauth/callback?error=access_denied&state=${encodeURIComponent(authorization.searchParams.get('state')!)}`,
  );
  await page
    .getByRole('alert')
    .getByText('Authorization did not complete.', { exact: false })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, '/providers/github');
  await page.screenshot({ path: 'artifacts/providers-denied.png', fullPage: true });
  console.log(
    'GitHub browser journey passed: backend OAuth configuration, real consent redirect and denied authorization recovery.',
  );
}

export async function githubOAuthSuccessJourney(input: {
  page: Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
  origin: string;
}) {
  const { page, origin } = input;
  await page.goto(`${origin}/providers/github`);
  await page.getByRole('button', { name: 'OAuth', exact: true }).click();
  await page.screenshot({
    path: 'artifacts/provider-oauth-configured.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: /^Connect (another )?account$/ }).click();
  await page.getByRole('heading', { name: 'Consent boundary' }).waitFor();
  const authorization = new URL(page.url());
  const state = authorization.searchParams.get('state');
  assert.ok(state);
  await page.goto(
    `${origin}/api/open-sync/oauth/callback?code=browser-test-code&state=${encodeURIComponent(state)}`,
  );
  await page.getByText('Connected', { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, '/providers/github');
}

export async function githubOAuthReconnectJourney(input: {
  page: Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
  origin: string;
  connectionId: string;
}) {
  const { page, origin, connectionId } = input;
  await page.locator(`a[href*="connectionId=${connectionId}"]`).click();
  await page.getByRole('heading', { name: /^Reconnect / }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'API key', exact: true }).count(), 0);
  assert.equal(await page.getByText('Cancel reconnect', { exact: true }).count(), 0);
  const appSection = page.getByRole('region', { name: 'OAuth app', exact: true });
  const accountsSection = page.getByRole('region', { name: 'Accounts', exact: true });
  const appBounds = await appSection.boundingBox();
  const accountBounds = await accountsSection.boundingBox();
  assert.ok(appBounds && accountBounds && appBounds.y + appBounds.height < accountBounds.y);
  await accountsSection.getByRole('link', { name: 'Back to accounts' }).click();
  await accountsSection.getByText('Connected', { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).searchParams.has('connectionId'), false);
  await accountsSection.locator(`a[href*="connectionId=${connectionId}"]`).click();
  await accountsSection.getByRole('heading', { name: /^Reconnect / }).waitFor();
  await page.screenshot({
    path: 'artifacts/provider-reconnect.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Reconnect account', exact: true }).click();
  await page.getByRole('heading', { name: 'Consent boundary' }).waitFor();
  const deniedState = new URL(page.url()).searchParams.get('state')!;
  await page.goto(
    `${origin}/api/open-sync/oauth/callback?error=access_denied&state=${encodeURIComponent(deniedState)}`,
  );
  await page
    .getByRole('alert')
    .getByText('Authorization did not complete.', { exact: false })
    .waitFor();
  // A denied attempt must not replace the owned connection.
  await page.locator(`a[href*="connectionId=${connectionId}"]`).click();
  await page.getByRole('button', { name: 'Reconnect account', exact: true }).click();
  await page.getByRole('heading', { name: 'Consent boundary' }).waitFor();
  const state = new URL(page.url()).searchParams.get('state')!;
  await page.goto(
    `${origin}/api/open-sync/oauth/callback?code=browser-test-code&state=${encodeURIComponent(state)}`,
  );
  await page.getByText('Connected', { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, '/providers/github');
}
