import assert from 'node:assert/strict';
import { join } from 'node:path';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { SQL } from 'bun';
import type { startIsolatedApp } from './isolated-app';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
type App = Awaited<ReturnType<typeof startIsolatedApp>>;
const verificationPath = '**/api/auth/passkey/verify-registration';
const createButton = 'Create account with a passkey';
const forbiddenStatus = 403;

export async function ownerRegistrationJourney(input: { page: Page; app: App }) {
  const { page, app } = input;
  await page.goto(app.origin);
  await page.getByRole('button', { name: createButton }).waitFor();
  await page.screenshot({ path: 'artifacts/owner-setup.png', fullPage: true });
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
    await other.page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
    assert.equal(await other.page.getByRole('button', { name: createButton }).count(), 0);
  } finally {
    release.resolve();
    await other.close();
  }
}
