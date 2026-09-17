import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

/** Configure a synthetic source through the same catalog UI as any real source. */
export async function sampleSyncJourney(
  page: Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'],
) {
  await page.getByRole('link', { name: 'Destinations', exact: true }).click();
  await page.getByLabel('Destination', { exact: true }).click();
  await page.getByRole('option', { name: 'Local SQLite', exact: true }).click();
  await page.getByRole('button', { name: 'Add destination', exact: true }).click();
  await page.getByText('1 configured', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Syncs', exact: true }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Create sync', exact: true }).click();
  await page.getByLabel('Source', { exact: true }).click();
  await page.getByRole('option', { name: 'Sample data · 1', exact: true }).click();
  await page.getByLabel('Configuration (JSON)', { exact: true }).fill('{"count":12,"pageSize":3}');
  await page.getByLabel('Destination', { exact: true }).click();
  await page.getByRole('option', { name: 'Local SQLite · 1', exact: true }).click();
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.getByText('succeeded → Local SQLite', { exact: true }).waitFor();
}
