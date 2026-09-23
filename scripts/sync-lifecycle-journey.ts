import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];

export async function syncLifecycleJourney(input: {
  page: Page;
  origin: string;
  syncId: string;
  recordCount: number;
}) {
  const { page, origin, syncId, recordCount } = input;
  const syncPath = `/api/open-sync/sync/syncs/${syncId}`;
  const recordsUrl = `${origin}/api/receiver/records?syncId=${encodeURIComponent(syncId)}`;
  const before = await (await page.request.get(recordsUrl)).json();
  const prior = await (await page.request.get(`${origin}${syncPath}/runs`)).json();
  const connections = await (
    await page.request.get(`${origin}/api/open-sync/providers/connections`)
  ).json();
  await page.goto(`${origin}/syncs/${syncId}?section=history`);
  const completed = page.waitForResponse(async (response) => {
    if (new URL(response.url()).pathname !== `${syncPath}/runs` || !response.ok()) {
      return false;
    }
    const history = await response.json();
    return history.runs[0]?.mode === 'resync' && history.runs[0]?.state === 'succeeded';
  });
  await page.getByRole('button', { name: 'Resync', exact: true }).click();
  const replay = (await (await completed).json()).runs[0];
  assert.notEqual(replay.id, prior.runs[0].id);
  assert.equal(replay.recordsProcessed, recordCount);
  assert.equal(replay.recordsQueued, recordCount);
  await page.screenshot({
    path: 'artifacts/resync-history.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Queue', exact: true }).click();
  const drainTimeoutMs = 60_000;
  await page
    .getByText('Nothing waiting for delivery', { exact: true })
    .waitFor({ timeout: drainTimeoutMs });
  const replayed = await (await page.request.get(recordsUrl)).json();
  assert.equal(replayed.records.length, before.records.length);
  for (const record of replayed.records) {
    const previous = before.records.find((entry: { id: string }) => entry.id === record.id);
    assert.equal(record.revision, previous.revision + 1);
  }
  await page.goto(`${origin}/syncs/${syncId}?section=history`);
  const ordinary = page.waitForResponse(async (response) => {
    if (new URL(response.url()).pathname !== `${syncPath}/runs` || !response.ok()) {
      return false;
    }
    const history = await response.json();
    return history.runs[0]?.id !== replay.id && history.runs[0]?.state === 'succeeded';
  });
  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  const normal = (await (await ordinary).json()).runs[0];
  assert.equal(normal.mode, 'incremental');
  assert.equal(normal.recordsQueued, 0);
  await page.getByRole('button', { name: 'Remove sync', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok((await page.request.get(`${origin}${syncPath}`)).ok());
  await page.getByRole('button', { name: 'Remove sync', exact: true }).click();
  await page.screenshot({
    path: 'artifacts/remove-sync.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await page.screenshot({
    path: 'artifacts/remove-sync-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.waitForURL(`${origin}/syncs`);
  const notFound = 404;
  assert.equal((await page.request.get(`${origin}${syncPath}`)).status(), notFound);
  assert.deepEqual(await (await page.request.get(recordsUrl)).json(), replayed);
  assert.deepEqual(
    await (await page.request.get(`${origin}/api/open-sync/providers/connections`)).json(),
    connections,
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  console.log(
    'Sync lifecycle passed: resync redelivery with increasing revisions, normal dedup, removal with destination content and accounts retained.',
  );
}
