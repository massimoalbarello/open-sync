import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];

export async function sourceRetryJourney(input: { page: Page; origin: string; syncId: string }) {
  const { page, origin, syncId } = input;
  const retryTimeoutMs = 120_000;
  const syncPath = `/api/open-sync/sync/syncs/${syncId}`;
  await page
    .getByRole('cell', { name: /Retrying/ })
    .first()
    .waitFor();
  const before = await (await page.request.get(`${origin}${syncPath}`)).json();
  assert.equal(before.status, 'retrying');
  assert.equal(before.errorCode, 'source_http_429');
  const first = await (await page.request.get(`${origin}${syncPath}/runs`)).json();
  const runId = first.runs[0].id;
  await page.waitForResponse(
    async (response) => {
      if (new URL(response.url()).pathname !== syncPath || !response.ok()) {
        return false;
      }
      const sync = await response.json();
      return sync.status === 'retrying' && sync.nextDueAt > before.nextDueAt;
    },
    { timeout: retryTimeoutMs },
  );
  const retryHistory = await (await page.request.get(`${origin}${syncPath}/runs`)).json();
  assert.equal(retryHistory.runs[0].id, runId);
  assert.equal(retryHistory.runs[0].recordsProcessed, 0);
  assert.equal(await page.getByText('private-upstream-detail', { exact: false }).count(), 0);
  await page
    .getByRole('cell', { name: 'Completed', exact: true })
    .first()
    .waitFor({ timeout: retryTimeoutMs });

  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  await page.getByRole('cell', { name: /Paused/ }).waitFor();
  const paused = await (await page.request.get(`${origin}${syncPath}`)).json();
  assert.equal(paused.status, 'disabled');
  assert.equal(paused.errorCode, 'source_http_403');
  assert.equal(paused.enabled, false);
  assert.equal(await page.getByText('private-upstream-detail', { exact: false }).count(), 0);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForResponse(async (response) => {
    if (new URL(response.url()).pathname !== syncPath || !response.ok()) {
      return false;
    }
    return (await response.json()).status === 'succeeded';
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  console.log(
    'Source retry journey passed: engine-owned 30s/60s backoff, HTTP 503 recovery, permission pause and checkpoint-preserving resume.',
  );
}
