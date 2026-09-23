import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import type { ReceiverService } from '../apps/web/backend/src/services/receiver/service';
import type { SyncApi } from '../packages/sync/src/open-sync';

export type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
export interface Journey {
  page: Page;
  origin: string;
}

export async function readSync({ page, origin, id }: Journey & { id: string }) {
  const response = await page.request.get(`${origin}/api/open-sync/sync/syncs/${id}`);
  assert.ok(response.ok(), await response.text());
  return (await response.json()) as ReturnType<SyncApi['sync']>;
}

export async function readRecords({ page, origin, syncId }: Journey & { syncId: string }) {
  const response = await page.request.get(
    `${origin}/api/receiver/records?syncId=${encodeURIComponent(syncId)}`,
  );
  assert.ok(response.ok(), await response.text());
  return (await response.json()) as Awaited<ReturnType<ReceiverService['records']>>;
}

export async function waitForSync(input: Journey & { id: string }) {
  const timeoutMs = 120_000;
  const intervalMs = 100;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sync = await readSync(input);
    if (sync.status === 'succeeded') {
      return sync;
    }
    assert.ok(sync.enabled && Date.now() < deadline, JSON.stringify(sync));
    await Bun.sleep(intervalMs);
  }
}

export async function drainDeliveries({ page, origin }: Journey) {
  await page.goto(`${origin}/delivery`);
  const timeoutMs = 120_000;
  await page
    .getByText('Nothing waiting for delivery', { exact: true })
    .waitFor({ timeout: timeoutMs });
}

export async function createSync({ page, origin, source }: Journey & { source: string }) {
  await page.goto(`${origin}/syncs/new?source=${source}`);
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.waitForURL(/\/(syncs\/sync_|providers\/[^/]+\?syncId=)/);
  const url = new URL(page.url());
  return url.searchParams.get('syncId') ?? url.pathname.split('/').at(-1)!;
}

export async function capture({ page, name }: { page: Page; name: string }) {
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true, animations: 'disabled' });
}

export async function captureMobile({ page, name }: { page: Page; name: string }) {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await capture({ page, name });
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
}
