import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
type Attachment = { name: string; file: string };

export async function assetsJourney(input: {
  page: Page;
  origin: string;
  syncId: string;
  attachments: Attachment[];
}) {
  const { page, origin, syncId, attachments } = input;
  const recordsUrl = page.url();
  const expected = ['inline attachment', 'external attachment'];
  const related = page.getByRole('list', { name: /^Assets for / });
  assert.ok((await related.getByRole('link').count()) >= attachments.length);
  for (const [index, attachment] of attachments.entries()) {
    const href = `/assets/${attachment.file}`;
    const link = related.locator(`a[href="${href}"]`);
    assert.equal(await link.textContent(), attachment.name);
    await link.click();
    await page
      .getByText('Preview is not available for this file type.', { exact: false })
      .waitFor();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: `Download ${attachment.name}`, exact: true }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), attachment.name);
    assert.equal(await readFile((await download.path())!, 'utf8'), expected[index]);
    await download.delete();
    await page.goto(recordsUrl);
    await related.getByRole('link').first().waitFor();
  }
  await page.screenshot({
    path: 'artifacts/record-assets.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Assets', exact: true }).click();
  await page.getByRole('heading', { name: 'Assets', exact: true }).waitFor();
  await page.goto(`${origin}/assets?syncId=${encodeURIComponent(syncId)}`);
  const assets = page.getByRole('list', { name: 'Received assets' });
  await assets.getByRole('listitem').first().waitFor();
  assert.ok((await assets.getByRole('listitem').count()) >= attachments.length);
  for (const attachment of attachments) {
    await assets.locator(`a[href="/assets/${attachment.file}"]`).waitFor();
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
  await page.goto(`${origin}/assets?syncId=empty-source`);
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

export async function resumeAssetDelivery(input: { page: Page; origin: string; syncId: string }) {
  const { page, origin, syncId } = input;
  await page.goto(`${origin}/delivery`);
  await page.getByText('pending · receiver paused', { exact: true }).first().waitFor();
  for (const section of ['assets', 'records']) {
    const response = await page.request.get(
      `${origin}/api/receiver/${section}?syncId=${encodeURIComponent(syncId)}`,
    );
    assert.ok(response.ok());
    assert.deepEqual((await response.json())[section], []);
  }
  await page.getByRole('button', { name: 'Resume delivery', exact: true }).click();
  await page.getByRole('button', { name: 'Pause delivery', exact: true }).waitFor();
}
