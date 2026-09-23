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

export async function readDeliverables({ page, origin, syncId }: Journey & { syncId: string }) {
  const deliverables: NonNullable<Awaited<ReturnType<ReceiverService['deliverable']>>>[] = [];
  let before: number | null = null;
  do {
    const url = new URL(`/api/receiver/syncs/${syncId}/deliverables`, origin);
    if (before !== null) {
      url.searchParams.set('before', String(before));
    }
    const response = await page.request.get(url.href);
    assert.ok(response.ok(), await response.text());
    const result = (await response.json()) as Awaited<ReturnType<ReceiverService['deliverables']>>;
    for (const entry of result.deliverables) {
      const detail = await page.request.get(
        `${origin}/api/receiver/syncs/${syncId}/deliverables/${entry.id}`,
      );
      assert.ok(detail.ok(), await detail.text());
      deliverables.push(await detail.json());
    }
    before = result.nextCursor;
  } while (before !== null);
  return deliverables;
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

export async function drainDeliveries({ page, origin, syncId }: Journey & { syncId: string }) {
  const timeoutMs = 120_000;
  const intervalMs = 100;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await page.request.get(
      `${origin}/api/open-sync/sync/syncs/${syncId}/deliverables`,
    );
    assert.ok(response.ok(), await response.text());
    const result = (await response.json()) as ReturnType<SyncApi['deliveries']>;
    if (result.deliveries.length === 0) {
      return;
    }
    assert.ok(Date.now() < deadline, JSON.stringify(result));
    await Bun.sleep(intervalMs);
  }
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
