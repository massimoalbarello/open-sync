import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import type { ReceivedRecord } from '../apps/web/backend/src/repositories/receiver/contract';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
export async function previewsJourney(input: {
  page: Page;
  origin: string;
  record: ReceivedRecord;
}) {
  const { page, origin, record } = input;
  const recordUrl = `${origin}/records/${encodeURIComponent(record.sourceId)}/${encodeURIComponent(record.kind)}/${encodeURIComponent(record.id)}`;
  await page.goto(recordUrl);
  const content = page.getByRole('region', { name: 'Record content' });
  await content.getByRole('heading', { name: 'Lunch', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Data', exact: true }).waitFor();
  assert.ok((await page.locator('pre').boundingBox())!.y > (await content.boundingBox())!.y);
  await page.screenshot({
    path: 'artifacts/record-preview.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.reload();
  await content.getByText('Meet at noon?', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
    true,
  );
  await page.screenshot({
    path: 'artifacts/record-preview-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  for (const asset of record.assets.filter(
    (item) => item.mediaType !== 'application/octet-stream',
  )) {
    await page.goto(recordUrl);
    await page
      .getByRole('list', { name: `Assets for ${record.kind} ${record.id}` })
      .getByRole('link', { name: asset.name, exact: true })
      .click();
    await page.getByRole('heading', { name: asset.name, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, `/assets/${asset.id}`);
    await page.getByRole('link', { name: `Download ${asset.name}`, exact: true }).waitFor();
    if (asset.name === 'brief.pdf') {
      await page
        .locator('.react-pdf__Page__textContent')
        .getByText('Launch brief', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Next page' }).click();
      await page
        .locator('.react-pdf__Page__textContent')
        .getByText('Next steps', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Previous page' }).click();
      await page
        .locator('.react-pdf__Page__textContent')
        .getByText('Launch brief', { exact: true })
        .waitFor();
    } else if (asset.name === 'brief.docx') {
      await page
        .frameLocator('iframe[title="Document preview"]')
        .getByRole('heading', { name: 'What ships', exact: true })
        .waitFor();
      await page
        .frameLocator('iframe[title="Document preview"]')
        .getByRole('cell', { name: 'Preview dashboard', exact: true })
        .waitFor();
    } else if (asset.name.startsWith('forecast.')) {
      await page.getByRole('cell', { name: 'Record previews', exact: true }).waitFor();
      await page.getByLabel('Sheet', { exact: true }).click();
      await page.getByRole('option', { name: 'Volume', exact: true }).click();
      await page.getByRole('cell', { name: '1200', exact: true }).waitFor();
      await page.getByLabel('Sheet', { exact: true }).click();
      await page.getByRole('option', { name: 'Overview', exact: true }).click();
    } else if (asset.name === 'clip.mp4') {
      await page.waitForFunction(
        "document.querySelector('video')?.readyState >= 1 && document.querySelector('video')?.duration > 0",
      );
      const video = page.locator('video');
      await video.evaluate(async (element) => {
        await element.play();
        element.currentTime = 1;
      });
      await page.waitForFunction("document.querySelector('video')?.currentTime >= 1");
      await video.evaluate((element) => element.pause());
      const partial = await page.request.get(`${origin}/api/receiver/assets/${asset.id}/preview`, {
        headers: { range: 'bytes=0-15' },
      });
      const partialStatus = 206;
      assert.equal(partial.status(), partialStatus);
      const rangeLength = 16;
      assert.equal((await partial.body()).length, rangeLength);
      assert.match(partial.headers()['content-range']!, /^bytes 0-15\//);
      const unsatisfiable = await page.request.get(
        `${origin}/api/receiver/assets/${asset.id}/preview`,
        { headers: { range: 'bytes=999999999-' } },
      );
      const rangeError = 416;
      assert.equal(unsatisfiable.status(), rangeError);
    } else {
      await page.getByRole('img', { name: asset.name, exact: true }).waitFor();
      await page.waitForFunction(
        "[...document.querySelectorAll('main img')].some(image => image.naturalWidth > 0)",
      );
      assert.equal(await page.evaluate('window.svgExecuted'), undefined);
    }
    await page.screenshot({
      path: `artifacts/preview-${asset.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await markdownSafety({ page, record, recordUrl });
  await documentFailure({
    page,
    origin,
    asset: record.assets.find((asset) => asset.name === 'brief.docx')!,
  });
  await page.goto(`${origin}/assets/asset_00000000-0000-0000-0000-000000000000`);
  await page.getByText('This asset is no longer available.', { exact: true }).waitFor();
  await page.goto(`${recordUrl}-missing`);
  await page.getByText('This record is no longer available.', { exact: true }).waitFor();
}
async function markdownSafety(input: { page: Page; record: ReceivedRecord; recordUrl: string }) {
  const { page, record, recordUrl } = input;
  const endpoint = '**/api/receiver/records/detail?*';
  const asset = record.assets.find((item) => item.name === 'photo.jpg')!;
  await page.route(endpoint, (route) =>
    route.fulfill({
      json: {
        record: {
          ...record,
          content: {
            format: 'markdown',
            body: `# Safe preview\n\n**Readable** <em>HTML fragment</em>\n\n<script>window.markdownExecuted=true</script><img src="https://example.invalid/tracker" onerror="window.markdownExecuted=true"><a href="javascript:alert(1)">unsafe</a>\n\n[Photo](/api/receiver/assets/${asset.id})\n\n![Photo preview](/api/receiver/assets/${asset.id})`,
          },
        },
      },
    }),
  );
  const externalRequests: string[] = [];
  const track = (request: { url(): string }) => {
    if (request.url().includes('example.invalid')) {
      externalRequests.push(request.url());
    }
  };
  page.on('request', track);
  try {
    await page.goto(recordUrl);
    await page.getByRole('heading', { name: 'Safe preview', exact: true }).waitFor();
    assert.equal(await page.evaluate('window.markdownExecuted'), undefined);
    assert.equal(
      await page.locator('main script, main [onerror], main a[href^="javascript:"]').count(),
      0,
    );
    assert.equal(externalRequests.length, 0);
    await page.getByRole('link', { name: 'Photo', exact: true }).click();
    await page.getByRole('heading', { name: 'photo.jpg', exact: true }).waitFor();
  } finally {
    await page.unroute(endpoint);
    page.off('request', track);
  }
}
async function documentFailure(input: { page: Page; origin: string; asset: { id: string } }) {
  const { page, origin, asset } = input;
  const endpoint = `**/api/receiver/assets/${asset.id}`;
  await page.route(endpoint, (route) => route.fulfill({ body: 'not a docx file' }));
  try {
    await page.goto(`${origin}/assets/${asset.id}`);
    await page.reload();
    await page
      .getByRole('alert')
      .getByText('This file could not be previewed.', { exact: false })
      .waitFor();
    await page.getByRole('link', { name: 'Download brief.docx', exact: true }).waitFor();
  } finally {
    await page.unroute(endpoint);
  }
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page
    .frameLocator('iframe[title="Document preview"]')
    .getByRole('heading', { name: 'What ships', exact: true })
    .waitFor();
}
