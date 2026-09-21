import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];

export async function historySetupJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  await page.goto(`${origin}/syncs/new?source=github.pull-requests`);
  await page.getByLabel('History', { exact: true }).waitFor();
  await page
    .getByLabel('History', { exact: true })
    .getByText('Unlimited', { exact: true })
    .waitFor();
  await page.getByLabel('History', { exact: true }).click();
  await page.getByRole('option', { name: '3 years', exact: true }).click();
  for (const source of ['Gmail threads', 'Slack threads']) {
    await page.getByLabel('Source', { exact: true }).click();
    await page.getByRole('option', { name: source, exact: true }).click();
    await page
      .getByLabel('History', { exact: true })
      .getByText('Unlimited', { exact: true })
      .waitFor();
    await page.getByLabel('History', { exact: true }).click();
    await page.getByRole('option', { name: '1 year', exact: true }).click();
  }
  await page.screenshot({ path: 'artifacts/sync-history-form.png', animations: 'disabled' });
  await page.getByLabel('History', { exact: true }).click();
  await page.getByRole('option', { name: 'Unlimited', exact: true }).waitFor();
  assert.deepEqual(await page.getByRole('option').allTextContents(), [
    '3 months',
    '1 year',
    '3 years',
    'Unlimited',
  ]);
  await page.screenshot({ path: 'artifacts/sync-history-picker.png', animations: 'disabled' });
  await page.getByRole('option', { name: '3 months', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('History', { exact: true }).click();
  await page.getByRole('option', { name: 'Unlimited', exact: true }).waitFor();
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await page.screenshot({
    path: 'artifacts/sync-history-picker-mobile.png',
    animations: 'disabled',
  });
  await page.getByRole('option', { name: '3 months', exact: true }).click();
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.waitForURL(/\/syncs\/sync_/);
  const syncId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('link', { name: 'Polling history', exact: true }).click();
  await page.getByRole('cell', { name: 'Completed', exact: true }).waitFor();
  const installation = await (
    await page.request.get(`${origin}/api/open-sync/sync/installations/${syncId}`)
  ).json();
  assert.deepEqual(installation.config, { history: '3 months' });
  const polls = await (
    await page.request.get(`${origin}/api/open-sync/sync/installations/${syncId}/polls`)
  ).json();
  assert.equal(polls.polls[0].recordsProcessed, 0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${origin}/syncs/new?source=granola.meetings`);
  await page.getByLabel('Source', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('History', { exact: true }).count(), 0);
  console.log(
    'History picker passed: source defaults, range selection, persistence and bounded Slack discovery.',
  );
}
