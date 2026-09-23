import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];

export async function historySetupJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  await page.goto(`${origin}/syncs/new?source=github.pull-requests`);
  await page.getByLabel('Interval', { exact: true }).waitFor();
  await page.getByLabel('Interval', { exact: true }).getByText('All', { exact: true }).waitFor();
  await page.getByLabel('Interval', { exact: true }).click();
  await page.getByRole('option', { name: 'Last 3 years', exact: true }).click();
  for (const source of ['Gmail threads', 'Slack threads']) {
    await page.getByLabel('Source', { exact: true }).click();
    await page.getByRole('option', { name: source, exact: true }).click();
    await page.getByLabel('Interval', { exact: true }).getByText('All', { exact: true }).waitFor();
    await page.getByLabel('Interval', { exact: true }).click();
    await page.getByRole('option', { name: 'Last 1 year', exact: true }).click();
  }
  await page.screenshot({ path: 'artifacts/sync-history-form.png', animations: 'disabled' });
  await page.getByLabel('Interval', { exact: true }).click();
  await page.getByRole('option', { name: 'All', exact: true }).waitFor();
  assert.deepEqual(await page.getByRole('option').allTextContents(), [
    'Last 3 months',
    'Last 1 year',
    'Last 3 years',
    'All',
  ]);
  await page.screenshot({ path: 'artifacts/sync-history-picker.png', animations: 'disabled' });
  await page.getByRole('option', { name: 'Last 3 months', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Interval', { exact: true }).click();
  await page.getByRole('option', { name: 'All', exact: true }).waitFor();
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await page.screenshot({
    path: 'artifacts/sync-history-picker-mobile.png',
    animations: 'disabled',
  });
  await page.getByRole('option', { name: 'Last 3 months', exact: true }).click();
  const submitted = page.waitForRequest(
    (request) => request.url().endsWith('/api/dashboard/syncs') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  assert.deepEqual((await submitted).postDataJSON().config, { history: 'Last 3 months' });
  await page.waitForURL(/\/syncs\/sync_/);
  const syncId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('link', { name: 'Run history', exact: true }).click();
  await page.getByRole('cell', { name: 'Completed', exact: true }).waitFor();
  const sync = await (
    await page.request.get(`${origin}/api/open-sync/sync/syncs/${syncId}`)
  ).json();
  assert.equal(Object.hasOwn(sync, 'config'), false);
  const history = await (
    await page.request.get(`${origin}/api/open-sync/sync/syncs/${syncId}/runs`)
  ).json();
  assert.equal(history.runs[0].recordsProcessed, 0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${origin}/syncs/new?source=granola.meetings`);
  await page.getByLabel('Source', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Interval', { exact: true }).count(), 0);
  console.log(
    'Interval picker passed: source defaults, range selection, persistence and bounded Slack discovery.',
  );
}
