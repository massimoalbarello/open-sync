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
  await page.getByRole('link', { name: 'Authorization', exact: true }).click();
  await page.getByRole('button', { name: 'OAuth', exact: true }).click();
  const connect = page.getByRole('button', { name: 'Connect GitHub' });
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
