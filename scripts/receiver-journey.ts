import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  capture,
  captureMobile,
  drainDeliveries,
  type Journey,
  readDeliverables,
  waitForSync,
} from './browser-journey';
import { granolaFixtureMeetingCount } from './example-provider-fixtures';

export async function inspectReceivedJourney(
  input: Journey & { syncId: string; service: string; kind: string },
) {
  const { page, origin, syncId, service, kind } = input;
  const received = await readDeliverables(input);
  const records = received.flatMap((entry) => entry.deliverable.records);
  assert.equal(records[0]!.kind, kind);
  if (service === 'granola') {
    assert.equal(records.length, granolaFixtureMeetingCount);
    assert.equal(new Set(records.map((record) => record.id)).size, granolaFixtureMeetingCount);
  }
  assert.ok(!JSON.stringify(received).includes('fixture-token'));
  const bundle = received.find((entry) => entry.deliverable.assets.length > 0) ?? received[0]!;
  const { deliverable } = bundle;
  await page.goto(`${origin}/syncs/${syncId}/deliverables/${deliverable.id}?received=true`);
  await page.getByRole('heading', { name: /^Records/ }).waitFor();
  await page.locator('pre').getByText(`"kind": "${kind}"`, { exact: false }).waitFor();
  if (service === 'gmail' || service === 'slack') {
    const expected =
      service === 'gmail'
        ? ['inline attachment', 'external attachment']
        : ['private Slack attachment'];
    assert.equal(deliverable.assets.length, expected.length);
    assert.ok(JSON.stringify(deliverable.records).includes('open-sync-asset:'));
    assert.ok(!JSON.stringify(deliverable).includes('files.slack.com'));
    for (const [index, asset] of deliverable.assets.entries()) {
      const href = `/api/receiver/syncs/${syncId}/deliverables/${deliverable.id}/assets/${index}`;
      const link = page.locator(`a[href="${href}"]`);
      await link.waitFor();
      const downloaded = page.waitForEvent('download');
      await link.click();
      const download = await downloaded;
      assert.equal(download.suggestedFilename(), asset.name);
      assert.equal(await readFile((await download.path())!, 'utf8'), expected[index]);
      await download.delete();
    }
    if (service === 'gmail') {
      await receiverAccess({ ...input, id: deliverable.id });
    }
    await capture({ page, name: 'deliverable-assets' });
    await captureMobile({ page, name: 'deliverable-assets-mobile' });
  }
}

export async function paginationJourney(input: Journey) {
  const { page, origin } = input;
  const response = await page.request.post(`${origin}/api/dashboard/syncs`, {
    headers: { origin },
    data: { source: 'fixture.polls', destination: { type: 'local', input: {} } },
  });
  assert.ok(response.ok(), await response.text());
  const { id: syncId } = (await response.json()) as { id: string };
  const count = 22;
  await waitForSync({ ...input, id: syncId });
  for (let iteration = 1; iteration < count; iteration++) {
    const resync = await page.request.post(`${origin}/api/open-sync/sync/syncs/${syncId}/resync`, {
      headers: { origin },
    });
    assert.ok(resync.ok(), await resync.text());
    await waitForSync({ ...input, id: syncId });
  }
  await drainDeliveries({ ...input, syncId });
  await paginatedList({
    ...input,
    syncId,
    count,
    view: 'polls',
    label: 'Polling iterations',
    endpoint: `${origin}/api/open-sync/sync/syncs/${syncId}/polls`,
  });
  await paginatedList({
    ...input,
    syncId,
    count,
    view: 'received',
    label: 'Received deliverables',
    endpoint: `${origin}/api/receiver/syncs/${syncId}/deliverables`,
  });
}

async function paginatedList(
  input: Journey & {
    syncId: string;
    count: number;
    view: string;
    label: string;
    endpoint: string;
  },
) {
  const { page, origin, syncId, count, view, label, endpoint } = input;
  const pageSize = 20;
  const cursors: string[] = [];
  let failNextPage = true;
  const pattern = `${endpoint}?*`;
  // Keep data and pagination real; fail one later page to prove the existing rows survive retry.
  await page.route(pattern, async (route) => {
    const before = new URL(route.request().url()).searchParams.get('before');
    if (before) {
      cursors.push(before);
      if (failNextPage) {
        await route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
        return;
      }
    }
    await route.continue();
  });
  try {
    await page.goto(`${origin}/syncs/${syncId}?view=${view}`);
    const rows = page.getByRole('list', { name: label, exact: true }).getByRole('listitem');
    await rows.nth(pageSize - 1).waitFor();
    assert.equal(await rows.count(), pageSize);
    assert.equal(await page.getByRole('link', { name: 'View records', exact: true }).count(), 0);
    await rows.last().scrollIntoViewIfNeeded();
    const retry = page.getByRole('button', { name: 'Try loading more again', exact: true });
    await retry.waitFor();
    assert.equal(await rows.count(), pageSize);
    failNextPage = false;
    await retry.click();
    await rows.nth(count - 1).waitFor();
    assert.equal(await rows.count(), count);
    assert.ok(cursors.length > 1);
    assert.equal(new Set(cursors).size, 1);
    assert.equal(await page.getByRole('button', { name: 'Load more', exact: true }).count(), 0);
    await capture({ page, name: `${view}-pagination` });
  } finally {
    await page.unroute(pattern);
  }
}

async function receiverAccess(input: Journey & { syncId: string; id: string }) {
  const { page, origin, syncId, id } = input;
  const unauthorized = 401;
  const missing = 404;
  const detail = `/api/receiver/syncs/${syncId}/deliverables/${id}`;
  const anonymous = await page.context().browser()!.newContext();
  try {
    for (const path of [
      `/api/receiver/syncs/${syncId}/deliverables`,
      detail,
      `${detail}/assets/0`,
    ]) {
      assert.equal((await anonymous.request.get(`${origin}${path}`)).status(), unauthorized);
    }
  } finally {
    await anonymous.close();
  }
  // Knowing a valid deliverable ID must not grant access through a different sync.
  for (const suffix of ['', '/assets/0']) {
    const response = await page.request.get(
      `${origin}/api/receiver/syncs/another-sync/deliverables/${id}${suffix}`,
    );
    assert.equal(response.status(), missing);
  }
}
