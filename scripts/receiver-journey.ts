import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ReceivedRecord } from '../apps/web/backend/src/repositories/receiver/contract';
import type { ReceiverService } from '../apps/web/backend/src/services/receiver/service';
import { capture, captureMobile, type Page } from './browser-journey';

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
  await capture({ page, name: 'record-assets' });
  await page.getByRole('link', { name: 'Assets', exact: true }).click();
  await page.getByRole('heading', { name: 'Assets', exact: true }).waitFor();
  await page.goto(`${origin}/assets?syncId=${encodeURIComponent(syncId)}`);
  const assets = page.getByRole('list', { name: 'Received assets' });
  await assets.getByRole('listitem').first().waitFor();
  assert.ok((await assets.getByRole('listitem').count()) >= attachments.length);
  for (const attachment of attachments) {
    await assets.locator(`a[href="/assets/${attachment.file}"]`).waitFor();
  }
  await capture({ page, name: 'assets-desktop' });
  await captureMobile({ page, name: 'assets-mobile' });
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

export async function previewsJourney(input: {
  page: Page;
  origin: string;
  record: ReceivedRecord;
}) {
  const { page, origin, record } = input;
  const recordUrl = `${origin}/records/${encodeURIComponent(record.syncId)}/${encodeURIComponent(record.kind)}/${encodeURIComponent(record.id)}`;
  await page.goto(recordUrl);
  const content = page.getByRole('region', { name: 'Record content' });
  await content.getByRole('heading', { name: 'Lunch', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Data', exact: true }).waitFor();
  assert.ok((await page.locator('pre').boundingBox())!.y > (await content.boundingBox())!.y);
  await capture({ page, name: 'record-preview' });
  await page.reload();
  await content.getByText('Meet at noon?', { exact: true }).waitFor();
  await captureMobile({ page, name: 'record-preview-mobile' });

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

type RecordPage = Awaited<ReturnType<ReceiverService['records']>>;
type AssetPage = Awaited<ReturnType<ReceiverService['assets']>>;
const pageSize = 50;
const count = 62;
const idWidth = 3;
const uuidSuffixWidth = 12;
const middleDayCount = 58;
const dates = [
  'Tuesday, September 22, 2026',
  'Monday, September 21, 2026',
  'Sunday, September 20, 2026',
  'Unknown date',
];

function updatedAt(index: number): string | undefined {
  if (index === 0) {
    return '2026-09-22T08:45:00.000Z';
  }
  if (index === 1) {
    // Still September 21 in UTC, but September 22 in the browser's time zone.
    return '2026-09-21T23:30:00.000Z';
  }
  if (index === count - 1) {
    return undefined;
  }
  const minuteMs = 60_000;
  return index === count - 2
    ? '2026-09-20T12:00:00.000Z'
    : new Date(Date.parse('2026-09-21T12:00:00Z') - index * minuteMs).toISOString();
}

export async function receiverTimelineJourney(input: { page: Page; origin: string }) {
  for (const resource of ['records', 'assets'] as const) {
    await timelineList({ ...input, resource });
  }
}

async function timelineList(input: { page: Page; origin: string; resource: 'records' | 'assets' }) {
  const { page, origin, resource } = input;
  const endpoint = `${origin}/api/receiver/${resource}?*`;
  const offsets: number[] = [];
  let failNextPage = true;
  // Exercise presentation at the typed HTTP boundary; SQLite tests own timestamp ordering.
  await page.route(endpoint, async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get('syncId'), 'timeline');
    const offset = Number(url.searchParams.get('offset'));
    offsets.push(offset);
    if (offset === pageSize && failNextPage) {
      await route.fulfill({ status: 500, json: { error: 'Temporary failure' } });
      return;
    }
    const indexes = Array.from(
      { length: Math.min(pageSize, count - offset) },
      // biome-ignore lint/complexity/useMaxParams: Array.from supplies the item and index.
      (_, i) => offset + i,
    );
    const records: RecordPage = {
      records: indexes.map((index) => ({
        syncId: 'timeline',
        kind: 'note',
        id: `daily-${String(index).padStart(idWidth, '0')}`,
        revision: 1,
        updatedAt: updatedAt(index),
        createdAt: index === count - 1 ? '2026-09-23T00:00:00.000Z' : undefined,
        data: {},
        assets: [],
      })),
      hasMore: offset + pageSize < count,
      pageSize,
    };
    const assets: AssetPage = {
      assets: indexes.map((index) => ({
        syncId: 'timeline',
        id: `asset_00000000-0000-0000-0000-${String(index).padStart(uuidSuffixWidth, '0')}`,
        name: `Meeting notes ${String(index).padStart(idWidth, '0')}.txt`,
        mediaType: 'text/plain',
        size: 2048,
        updatedAt: updatedAt(index),
        createdAt: index === count - 1 ? '2026-09-23T00:00:00.000Z' : undefined,
      })),
      hasMore: offset + pageSize < count,
      pageSize,
    };
    await route.fulfill({ json: resource === 'records' ? records : assets });
  });
  try {
    await page.goto(`${origin}/${resource}?syncId=timeline`);
    const rows = page
      .getByRole('list', { name: `Received ${resource}`, exact: true })
      .getByRole('listitem');
    await rows.nth(pageSize - 1).waitFor();
    assert.equal(await rows.count(), pageSize);
    assert.deepEqual(
      await page.getByRole('heading', { level: 2 }).allTextContents(),
      dates.slice(0, 2),
    );
    assert.equal(
      await page.getByRole('region', { name: dates[0], exact: true }).getByRole('listitem').count(),
      2,
    );
    await page.screenshot({ path: `artifacts/${resource}-by-day.png`, animations: 'disabled' });
    await rows.last().scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Try loading more again', exact: true }).waitFor();
    assert.equal(await rows.count(), pageSize);
    failNextPage = false;
    await page.getByRole('button', { name: 'Try loading more again', exact: true }).click();
    await rows.nth(count - 1).waitFor();
    assert.ok(offsets.includes(pageSize));
    assert.equal(await rows.count(), count);
    assert.deepEqual(await page.getByRole('heading', { level: 2 }).allTextContents(), dates);
    assert.equal(
      await page.getByRole('region', { name: dates[1], exact: true }).getByRole('listitem').count(),
      middleDayCount,
    );
    assert.equal(await page.getByRole('button', { name: 'Load more', exact: true }).count(), 0);
    const links = await rows
      .getByRole('link')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
    assert.equal(new Set(links).size, count);
  } finally {
    await page.goto('about:blank');
    await page.unroute(endpoint);
  }
}
