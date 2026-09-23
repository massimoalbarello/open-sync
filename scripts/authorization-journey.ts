import assert from 'node:assert/strict';
import { join } from 'node:path';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { SQL } from 'bun';
import { capture, captureMobile, type Journey, type Page, waitForSync } from './browser-journey';
import type { startIsolatedApp } from './isolated-app';

type App = Awaited<ReturnType<typeof startIsolatedApp>>;
const verificationPath = '**/api/auth/passkey/verify-registration';
const createButton = 'Create account';
const forbiddenStatus = 403;

export async function ownerRegistrationJourney(input: { page: Page; app: App }) {
  const { page, app } = input;
  await page.goto(app.origin);
  await page.getByRole('button', { name: createButton }).waitFor();
  await capture({ page, name: 'owner-setup' });
  await page.goto('about:blank');
  // Failed registration can leave a resident credential on an authenticator even though
  // server persistence rolled back. Keep those credentials out of the owner's sign-in test.
  const failures = await virtualPasskeyBrowser({ headless: true });
  try {
    await failedRegistrations({ page: failures.page, app });
  } finally {
    await failures.close();
  }
  await page.goto(app.origin);
  await delayedRegistration({ page, origin: app.origin });
  assert.deepEqual(await registrationCounts(app), { users: 1, passkeys: 1 });
}

async function failedRegistrations(input: { page: Page; app: App }) {
  const { page, app } = input;
  await page.goto(app.origin);
  // Unsigned registration must request the transaction covering owner, passkey and session.
  await page.route(verificationPath, (route) =>
    route.continue({
      postData: JSON.stringify({ ...route.request().postDataJSON(), createSession: false }),
    }),
  );
  await rejectedRegistration({ page, status: 400 });
  await page.unroute(verificationPath);
  await page.goto('about:blank');
  assert.deepEqual(await registrationCounts(app), { users: 0, passkeys: 0 });

  // Change the failure fixture with the backend stopped, never during an auth request.
  await passkeyWriteFailure({ app, enabled: true });
  try {
    await page.goto(app.origin);
    await rejectedRegistration({ page, status: 500 });
    await page.goto('about:blank');
    assert.deepEqual(await registrationCounts(app), { users: 0, passkeys: 0 });
  } finally {
    await page.goto('about:blank');
    await passkeyWriteFailure({ app, enabled: false });
  }
}

async function registrationCounts(app: App) {
  const db = new SQL({ adapter: 'sqlite', filename: join(app.dataFolder, 'app.db') });
  try {
    const [counts] = await db<{ users: number; passkeys: number }[]>`
      SELECT (SELECT count(*) FROM auth_user) AS users,
             (SELECT count(*) FROM auth_passkey) AS passkeys`;
    return counts;
  } finally {
    await db.close();
  }
}

async function passkeyWriteFailure(input: { app: App; enabled: boolean }) {
  await input.app.restartServer({
    beforeStart: async () => {
      const db = new SQL({ adapter: 'sqlite', filename: join(input.app.dataFolder, 'app.db') });
      try {
        await db.unsafe(
          input.enabled
            ? "CREATE TRIGGER fail_passkey BEFORE INSERT ON auth_passkey BEGIN SELECT RAISE(ABORT, 'test persistence failure'); END"
            : 'DROP TRIGGER fail_passkey',
        );
      } finally {
        await db.close();
      }
    },
  });
}

async function rejectedRegistration(input: { page: Page; status: number }) {
  const [response] = await Promise.all([
    input.page.waitForResponse('**/api/auth/passkey/verify-registration'),
    input.page.getByRole('button', { name: createButton }).click(),
  ]);
  assert.equal(response.status(), input.status);
  await input.page.getByRole('alert').waitFor();
}

async function delayedRegistration(input: { page: Page; origin: string }) {
  const other = await virtualPasskeyBrowser({ headless: true });
  const release = Promise.withResolvers<void>();
  try {
    await other.page.goto(input.origin);
    await other.page.route(verificationPath, async (route) => {
      await release.promise;
      await route.continue();
    });
    const response = other.page.waitForResponse('**/api/auth/passkey/verify-registration');
    await Promise.all([
      other.page.waitForRequest('**/api/auth/passkey/verify-registration'),
      other.page.getByRole('button', { name: createButton }).click(),
    ]);
    await input.page.getByRole('button', { name: createButton }).click();
    await input.page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
    release.resolve();
    assert.equal((await response).status(), forbiddenStatus);
    await other.page.getByRole('button', { name: 'Sign in' }).waitFor();
    assert.equal(await other.page.getByRole('button', { name: createButton }).count(), 0);
  } finally {
    release.resolve();
    await other.close();
  }
}

export async function brandFallbackJourney({ origin }: { origin: string }) {
  const browser = await virtualPasskeyBrowser({ headless: true });
  try {
    const { page } = browser;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(origin);
    await page.locator('[data-light-state="unavailable"]').waitFor();
    const register = page.getByRole('button', { name: 'Create account' });
    assert.ok(await register.isEnabled());
    assert.equal(await page.locator('[data-light-state] span').isVisible(), true);
    await page.screenshot({ path: 'artifacts/login-reduced-motion.png' });
    // A missing GPU must never prevent the real passkey flow from mounting.
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await page.locator('[data-light-state="unavailable"]').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await register.isEnabled());
    assert.equal(await page.locator('[data-light-state] span').isVisible(), true);
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'));
    await capture({ page, name: 'login-mobile-fallback' });
  } finally {
    await browser.close();
  }
}

export async function githubOAuthJourney(input: { page: Page; origin: string }) {
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
  await capture({ page, name: 'providers-configured' });
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
  await capture({ page, name: 'providers-denied' });
  console.log(
    'GitHub browser journey passed: backend OAuth configuration, real consent redirect and denied authorization recovery.',
  );
}

export async function githubOAuthSuccessJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  const accountId = crypto.randomUUID();
  await page.goto(`${origin}/providers/github`);
  await page.getByRole('button', { name: 'OAuth', exact: true }).click();
  await capture({ page, name: 'provider-oauth-configured' });
  await page.getByRole('button', { name: /^Connect (another )?account$/ }).click();
  await page.getByRole('heading', { name: 'Consent boundary' }).waitFor();
  const authorization = new URL(page.url());
  const state = authorization.searchParams.get('state');
  assert.ok(state);
  await page.goto(
    `${origin}/api/open-sync/oauth/callback?code=${accountId}/connect&state=${encodeURIComponent(state)}`,
  );
  await page.getByText('Connected', { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, '/providers/github');
  return accountId;
}

export async function githubOAuthReconnectJourney(input: {
  page: Page;
  origin: string;
  connectionId: string;
  accountId: string;
}) {
  const { page, origin, connectionId } = input;
  await page.locator(`a[href*="connectionId=${connectionId}"]`).click();
  await page.getByRole('heading', { name: /^Reconnect / }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'API key', exact: true }).count(), 0);
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
    `${origin}/api/open-sync/oauth/callback?code=${input.accountId}/reconnect&state=${encodeURIComponent(state)}`,
  );
  await page.getByText('Connected', { exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, '/providers/github');
}

export async function copyAuthorizationJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  const initialUrl = page.url();
  const copy = page.getByRole('button', { name: 'Copy authorization link', exact: true });
  const context = page.context();
  // Deny clipboard access at the browser boundary; authorization and the session stay real.
  await context.grantPermissions([], { origin });
  await copy.click();
  const manual = page.getByRole('textbox', { name: 'Authorization link', exact: true });
  await manual.waitFor();
  assert.equal(page.url(), initialUrl);
  const manualUrl = new URL(await manual.inputValue());
  assert.equal(manualUrl.hostname, 'slack.com');
  assert.ok(manualUrl.searchParams.get('state'));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await copy.click();
  await page.getByRole('status').filter({ hasText: 'Authorization link copied.' }).waitFor();
  assert.equal(page.url(), initialUrl);
  assert.equal(await manual.count(), 0);
  const copiedUrl = new URL(await page.evaluate<string>('navigator.clipboard.readText()'));
  assert.equal(copiedUrl.origin, manualUrl.origin);
  assert.notEqual(copiedUrl.searchParams.get('state'), manualUrl.searchParams.get('state'));
  // Paste the copied link into a navigation; the caller completes the real OAuth callback.
  await page.goto(copiedUrl.href);
}

export async function providerSetupJourney(input: { page: Page; origin: string }) {
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
  await capture({ page, name: 'provider-accounts' });
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
  } finally {
    await page.unroute(providerPattern);
  }
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.waitForURL(/\/syncs\/sync_/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await waitForSync({ ...input, id: id });
  await page
    .locator('main header')
    .getByText('Account: work@example.com', { exact: true })
    .waitFor();
  await page.goto(`${origin}/syncs`);
  await page.getByText('Account: work@example.com', { exact: true }).waitFor();
  await capture({ page, name: 'sync-accounts' });
  const sync = await (await page.request.get(`${origin}/api/open-sync/sync/syncs/${id}`)).json();
  const status = await (await page.request.get(`${origin}/api/open-sync/providers/gmail`)).json();
  assert.equal(
    sync.connection.id,
    status.connections.find((entry: { account: string }) => entry.account === 'work@example.com')
      .id,
  );
  await page.goto(`${origin}/providers/gmail`);
  await page.getByRole('button', { name: 'Connect another account', exact: true }).waitFor();
  await captureMobile({ page, name: 'provider-accounts-mobile' });
  console.log(
    'Provider setup journey passed: callback visibility, multiple accounts, and account selection during sync creation.',
  );
}

export async function configureGithub(input: Journey & { app: App }) {
  const { page, origin, app } = input;
  await page.getByRole('link', { name: 'Providers', exact: true }).click();
  const cards = page.getByRole('list', { name: 'Providers', exact: true }).getByRole('listitem');
  const providerPageSize = 30;
  await cards.nth(providerPageSize - 1).waitFor();
  assert.equal(await cards.count(), providerPageSize);
  await capture({ page, name: 'providers-desktop' });
  await cards.last().scrollIntoViewIfNeeded();
  await cards.nth(providerPageSize).waitFor();
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
  await capture({ page, name: 'provider-oauth-setup' });
  await page.getByRole('button', { name: 'Save OAuth app', exact: true }).click();
  await page.getByRole('button', { name: 'Edit OAuth app', exact: true }).waitFor();
  await page.goto('about:blank');
  await app.restartServer();
  await githubOAuthJourney({ page, origin: origin });
}

export async function sessionJourney({ page, origin }: Journey) {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('link', { name: 'Queue', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Toggle navigation' }).getAttribute('aria-expanded'),
      'false',
    );
    await capture({ page, name: 'queue-mobile' });
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  const unauthorized = 401;
  for (const path of [
    '/api/open-sync/sync/syncs',
    '/api/receiver/assets',
    '/api/open-sync/providers/catalog',
  ]) {
    assert.equal((await page.request.get(`${origin}${path}`)).status(), unauthorized);
  }
  await page.goto(`${origin}/records`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
}
