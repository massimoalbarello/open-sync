import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];

export async function sourceRetryJourney(input: { page: Page; origin: string; syncId: string }) {
  const { page, origin, syncId } = input;
  const retryMs = 30_000;
  const retryTimeoutMs = 120_000;
  const clockToleranceMs = 1000;
  const installationPath = `/api/open-sync/sync/installations/${syncId}`;
  await page.getByRole('cell', { name: 'Retrying', exact: true }).waitFor();
  const before = await (await page.request.get(`${origin}${installationPath}`)).json();
  assert.equal(before.checkpoint.channelId, null);
  assert.equal(before.checkpoint.messageCursor, null);
  assert.ok(
    Object.values(before.checkpoint).every((value) => value === null || typeof value !== 'object'),
  );
  assert.equal(before.checkpointRevision, 0);
  const first = await (await page.request.get(`${origin}${installationPath}/polls`)).json();
  const firstAttempt = first.polls[0].attempts[0];
  assert.equal(firstAttempt.state, 'source_http_429');
  assert.ok(Math.abs(before.nextDueAt - firstAttempt.completedAt - retryMs) < clockToleranceMs);

  const secondResponse = await page.waitForResponse(
    async (response) => {
      if (new URL(response.url()).pathname !== `${installationPath}/polls` || !response.ok()) {
        return false;
      }
      const history = await response.json();
      return (
        history.polls[0]?.attempts.filter((attempt: { state: string }) =>
          ['source_http_429', 'connector_request_failed'].includes(attempt.state),
        ).length === 2
      );
    },
    { timeout: retryTimeoutMs },
  );
  const second = (await secondResponse.json()).polls[0].attempts[0];
  const retried = await (await page.request.get(`${origin}${installationPath}`)).json();
  assert.deepEqual(retried.checkpoint, before.checkpoint);
  assert.ok(second.startedAt >= firstAttempt.completedAt + retryMs);
  assert.ok(Math.abs(retried.nextDueAt - second.completedAt - retryMs * 2) < clockToleranceMs);
  assert.equal(await page.getByText('private-upstream-detail', { exact: false }).count(), 0);
  await page
    .getByRole('cell', { name: 'Completed', exact: true })
    .first()
    .waitFor({ timeout: retryTimeoutMs });
  const completed = await (await page.request.get(`${origin}${installationPath}`)).json();
  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  await page.getByRole('cell', { name: 'Paused', exact: true }).waitFor();
  const paused = await (await page.request.get(`${origin}${installationPath}`)).json();
  assert.equal(paused.status, 'source_http_403');
  assert.equal(paused.enabled, false);
  assert.deepEqual(paused.checkpoint, completed.checkpoint);
  assert.equal(paused.checkpointRevision, completed.checkpointRevision);
  assert.equal(await page.getByText('private-upstream-detail', { exact: false }).count(), 0);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForResponse(async (response) => {
    if (new URL(response.url()).pathname !== installationPath || !response.ok()) {
      return false;
    }
    return (await response.json()).status === 'succeeded';
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  console.log(
    'Source retry journey passed: engine-owned 30s/60s backoff, HTTP 503 recovery, permission pause and checkpoint-preserving resume.',
  );
}
