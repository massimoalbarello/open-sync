import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import type { ReceiverService } from '../apps/web/backend/src/services/receiver/service';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
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
  const { page, origin } = input;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/London' });
  try {
    for (const resource of ['records', 'assets'] as const) {
      await timelineList({ page, origin, resource });
    }
  } finally {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' });
    await cdp.detach();
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
    assert.equal(url.searchParams.get('sourceId'), 'timeline');
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
        sourceId: 'timeline',
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
        sourceId: 'timeline',
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
    await page.goto(`${origin}/${resource}?sourceId=timeline`);
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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await page.screenshot({
      path: `artifacts/${resource}-by-day-mobile.png`,
      animations: 'disabled',
    });
    // A fresh query also reaches its second page through scrolling alone.
    await page.reload();
    await rows.nth(pageSize - 1).waitFor();
    await rows.last().scrollIntoViewIfNeeded();
    await rows.nth(count - 1).waitFor();
    assert.equal(await rows.count(), count);
  } finally {
    await page.goto('about:blank');
    await page.unroute(endpoint);
    await page.setViewportSize({ width: 1280, height: 720 });
  }
}
