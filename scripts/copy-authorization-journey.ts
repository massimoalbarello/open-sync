import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

export async function copyAuthorizationJourney(input: {
  page: Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
  origin: string;
}) {
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
  await manual.focus();
  assert.ok(
    await manual.evaluate((element) => {
      const input = element as unknown as {
        selectionStart: number;
        selectionEnd: number;
        value: string;
      };
      return input.selectionStart === 0 && input.selectionEnd === input.value.length;
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await page.screenshot({
    path: 'artifacts/copy-authorization-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await copy.click();
  await page.getByRole('status').filter({ hasText: 'Authorization link copied.' }).waitFor();
  assert.equal(page.url(), initialUrl);
  assert.equal(await manual.count(), 0);
  const copiedUrl = new URL(await page.evaluate<string>('navigator.clipboard.readText()'));
  assert.equal(copiedUrl.origin, manualUrl.origin);
  assert.equal(copiedUrl.searchParams.get('client_id'), 'fixture-slack');
  assert.equal(
    copiedUrl.searchParams.get('redirect_uri'),
    `${origin}/api/open-sync/oauth/callback`,
  );
  assert.ok(copiedUrl.searchParams.get('state'));
  assert.notEqual(copiedUrl.searchParams.get('state'), manualUrl.searchParams.get('state'));
  await page.screenshot({
    path: 'artifacts/copy-authorization-link.png',
    fullPage: true,
    animations: 'disabled',
  });
  // Paste the copied link into a navigation; the caller completes the real OAuth callback.
  await page.goto(copiedUrl.href);
}
