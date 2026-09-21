import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];

export async function sourceMetadataJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  await page.goto(`${origin}/records`);
  const rows = page.getByRole('list', { name: 'Received records' }).locator(':scope > li');
  await rows.first().getByRole('link').first().waitFor();
  await page.screenshot({ path: 'artifacts/record-previews-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
    true,
  );
  await page.screenshot({ path: 'artifacts/record-previews-mobile.png', animations: 'disabled' });

  // Exercise optional and long metadata at the typed API boundary, without changing stored data.
  const recordsEndpoint = '**/api/receiver/records?*';
  const recordCount = 3;
  const longPreviewIndex = 2;
  const datePreview = '2020-01-01T00:00:00.000Z';
  let fallbackLabel = '';
  await page.route(recordsEndpoint, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.records = body.records.slice(0, recordCount);
    body.hasMore = false;
    fallbackLabel = `${body.records[0].kind} · ${body.records[0].id}`;
    delete body.records[0].preview;
    delete body.records[0].createdAt;
    delete body.records[0].updatedAt;
    const previewRepetitions = 3;
    body.records[1].preview = datePreview;
    body.records[longPreviewIndex].preview =
      'A very long preview with <script>literal text</script> and a URL '.repeat(
        previewRepetitions,
      );
    await route.fulfill({ response, json: body });
  });
  try {
    await page.reload();
    await rows.nth(1).getByRole('link', { name: datePreview, exact: true }).waitFor();
    await rows
      .nth(longPreviewIndex)
      .getByText(/A very long preview/)
      .waitFor();
    assert.ok((await rows.first().innerText()).includes(fallbackLabel));
    assert.equal(await rows.first().locator('time').count(), 0);
    assert.equal(await rows.nth(longPreviewIndex).locator('script').count(), 0);
    assert.equal(
      await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
      true,
    );
    await rows.nth(longPreviewIndex).getByRole('link').first().click();
    await page.locator('pre').first().waitFor();
  } finally {
    await page.unroute(recordsEndpoint);
  }

  const assetsEndpoint = '**/api/receiver/assets?*';
  let assetName = '';
  await page.route(assetsEndpoint, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    assetName = body.assets[0].name;
    body.assets[0].createdAt = '2020-01-01T00:00:00.000Z';
    body.assets[0].updatedAt = '2020-01-02T00:00:00.000Z';
    await route.fulfill({ response, json: body });
  });
  try {
    await page.goto(`${origin}/assets`);
    const assets = page.getByRole('list', { name: 'Received assets' });
    await assets.locator('time').first().waitFor();
    assert.equal(await assets.locator('time').count(), 2);
    await assets.getByRole('link', { name: assetName, exact: true }).first().waitFor();
    assert.equal(
      await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
      true,
    );
    await page.screenshot({
      path: 'artifacts/asset-source-dates-mobile.png',
      animations: 'disabled',
    });
  } finally {
    await page.unroute(assetsEndpoint);
    await page.setViewportSize({ width: 1280, height: 720 });
  }
}
