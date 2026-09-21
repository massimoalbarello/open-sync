import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
type Attachment = { name: string; file: string };

export async function assetsJourney(input: {
  page: Page;
  origin: string;
  sourceId: string;
  attachments: Attachment[];
}) {
  const { page, origin, sourceId, attachments } = input;
  const recordsUrl = page.url();
  const expected = ['inline attachment', 'external attachment'];
  const related = page.getByRole('list', { name: /^Assets for / });
  assert.equal(await related.getByRole('link').count(), attachments.length);
  for (const [index, attachment] of attachments.entries()) {
    const href = `/api/receiver/assets/${attachment.file}`;
    const link = related.locator(`a[href="${href}"]`);
    assert.equal(await link.textContent(), attachment.name);
    const downloaded = page.waitForEvent('download');
    await link.click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), attachment.name);
    assert.equal(await readFile((await download.path())!, 'utf8'), expected[index]);
    await download.delete();
  }
  await page.screenshot({
    path: 'artifacts/record-assets.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Assets', exact: true }).click();
  await page.getByRole('heading', { name: 'Assets', exact: true }).waitFor();
  await page.goto(`${origin}/assets?sourceId=${encodeURIComponent(sourceId)}`);
  const assets = page.getByRole('list', { name: 'Received assets' });
  await assets.getByRole('listitem').first().waitFor();
  assert.equal(await assets.getByRole('listitem').count(), attachments.length);
  for (const attachment of attachments) {
    await assets.locator(`a[href="/api/receiver/assets/${attachment.file}"]`).waitFor();
  }
  await page.screenshot({
    path: 'artifacts/assets-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
    true,
  );
  await page.screenshot({
    path: 'artifacts/assets-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(recordsUrl);
  await related.getByRole('link').first().waitFor();
}

export async function assetsEmptyJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  await page.goto(`${origin}/assets?sourceId=empty-source`);
  await page.getByText('No assets received yet.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Go to syncs', exact: true }).click();
  await page.getByRole('heading', { name: 'Syncs', exact: true }).waitFor();
  const endpoint = '**/api/receiver/assets?*';
  await page.route(endpoint, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  try {
    await page.goto(`${origin}/assets`);
    await page
      .getByRole('alert')
      .getByText('Could not load received assets.', { exact: true })
      .waitFor();
  } finally {
    await page.unroute(endpoint);
  }
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('No assets received yet.', { exact: false }).waitFor();
}
