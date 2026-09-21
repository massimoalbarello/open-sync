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
  assert.equal(before.checkpoint.replyCursor, 'replies-2');
  assert.equal(before.checkpoint.messages.length, 2);
  const first = await (await page.request.get(`${origin}${installationPath}/polls`)).json();
  const firstAttempt = first.polls[0].attempts[0];
  assert.equal(firstAttempt.state, 'connector_request_failed');
  assert.ok(Math.abs(before.nextDueAt - firstAttempt.completedAt - retryMs) < clockToleranceMs);

  const secondResponse = await page.waitForResponse(
    async (response) => {
      if (new URL(response.url()).pathname !== `${installationPath}/polls` || !response.ok()) {
        return false;
      }
      const history = await response.json();
      return (
        history.polls[0]?.attempts.filter(
          (attempt: { state: string }) => attempt.state === 'connector_request_failed',
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
  console.log(
    'Source retry journey passed: persisted checkpoint, 30s/60s backoff, and recovery after HTTP 429/503.',
  );
}
