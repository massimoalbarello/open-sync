import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
const count = 51;

/** Seed through authenticated management APIs after the real passkey journey. */
export async function deliveryPaginationJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  const headers = { origin };
  const paused = await page.request.patch(`${origin}/api/receiver/settings`, {
    headers,
    data: { paused: true },
  });
  assert.ok(paused.ok());
  const { definitions } = await (
    await page.request.get(`${origin}/api/open-sync/sync/definitions`)
  ).json();
  const { destinations } = await (
    await page.request.get(`${origin}/api/open-sync/sync/destinations`)
  ).json();
  const definition = definitions.find((entry: { id: string }) => entry.id === 'sample');
  const destination = destinations.find((entry: { type: string }) => entry.type === 'local');
  const created = await page.request.post(`${origin}/api/open-sync/sync/installations`, {
    headers,
    data: { definition, config: { count, pageSize: 1 }, destinationId: destination.id },
  });
  assert.ok(created.ok());
  const installation = await created.json();
  await page.goto(`${origin}/syncs/${installation.id}`);
  await page.getByText('succeeded → Local SQLite', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Delivery queue', exact: true }).click();
  await page.getByText('Deliveries 1–50', { exact: true }).waitFor();
  const rows = page.getByRole('list', { name: 'Pending deliveries' }).getByRole('listitem');
  const pageSize = 50;
  assert.equal(await rows.count(), pageSize);
  await page.screenshot({ path: 'artifacts/delivery-page-one.png', animations: 'disabled' });
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await page.getByText('Deliveries 51–51', { exact: true }).waitFor();
  assert.equal(await rows.count(), 1);
  assert.equal(new URL(page.url()).searchParams.get('offset'), String(pageSize));
  await page.reload();
  await page.getByText('Deliveries 51–51', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/delivery-page-two.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Resume delivery', exact: true }).click();
  await page.getByText('No deliveries on this page.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'First page', exact: true }).click();
  await rows.first().waitFor();
  assert.ok((await rows.count()) <= pageSize);

  await page.getByRole('link', { name: 'Syncs', exact: true }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
  const queueRequests: string[] = [];
  const capture = (request: { url(): string }) => {
    if (new URL(request.url()).pathname === '/api/open-sync/sync/deliveries') {
      queueRequests.push(request.url());
    }
  };
  page.on('request', capture);
  try {
    // Observe the next actual status refresh, rather than guessing when navigation finishes.
    await page.waitForResponse('**/api/open-sync/sync/installations');
    assert.deepEqual(queueRequests, []);
  } finally {
    page.off('request', capture);
  }
}
