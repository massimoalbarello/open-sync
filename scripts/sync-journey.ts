import assert from 'node:assert/strict';
import {
  copyAuthorizationJourney,
  githubOAuthReconnectJourney,
  githubOAuthSuccessJourney,
  providerSetupJourney,
} from './authorization-journey';
import {
  capture,
  captureMobile,
  createSync,
  drainDeliveries,
  type Journey,
  readDeliverables,
  readSync,
  waitForSync,
} from './browser-journey';
import { githubFixtureRecordCount } from './example-provider-fixtures';
import { inspectReceivedJourney, paginationJourney } from './receiver-journey';

const sources = [
  {
    service: 'gmail',
    id: 'gmail.threads',
    name: 'Gmail threads',
    kind: 'thread',
    authorization: 'https://accounts.google.com/o/oauth2/v2/auth**',
  },
  {
    service: 'slack',
    id: 'slack.threads',
    name: 'Slack threads',
    kind: 'thread',
    authorization: 'https://slack.com/oauth/v2_user/authorize**',
  },
  {
    service: 'granola',
    id: 'granola.meetings',
    name: 'Granola meetings',
    kind: 'meeting',
    authorization: 'https://mcp-auth.granola.ai/oauth2/authorize**',
  },
];

export async function exampleSyncsJourney(input: Journey) {
  for (const source of sources) {
    await connectSource({ ...input, source });
  }
  await paginationJourney(input);
  await historySetupJourney(input);
  await destinationSetupJourney(input);
  await providerSetupJourney(input);
  console.log(
    'Example journeys passed: Gmail OAuth, Slack OAuth, Granola OAuth/MCP, and whole deliverables.',
  );
}

async function connectSource(input: {
  page: Journey['page'];
  origin: string;
  source: (typeof sources)[number];
}) {
  const { page, origin, source } = input;
  await page.route(source.authorization, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<h1>Example consent boundary</h1>',
    }),
  );
  const syncId = await createSync({ ...input, source: source.id });
  assert.equal(await page.getByRole('button', { name: 'API key', exact: true }).count(), 0);
  if (source.service === 'granola') {
    assert.equal(await page.getByLabel('Client ID', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Client secret', { exact: true }).count(), 0);
    await capture({ page, name: 'granola-connect' });
  } else {
    assert.equal(
      await page.getByRole('button', { name: 'Copy authorization link', exact: true }).isEnabled(),
      false,
    );
    await page.getByLabel('Client ID', { exact: true }).fill(`fixture-${source.service}`);
    await page.getByLabel('Client secret', { exact: true }).fill('fixture-client-secret');
    await page.getByRole('button', { name: 'Save OAuth app', exact: true }).click();
    await page.getByRole('button', { name: 'Edit OAuth app', exact: true }).waitFor();
  }
  if (source.service === 'slack') {
    await copyAuthorizationJourney(input);
  } else {
    await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  }
  if (source.service === 'granola') {
    await page
      .getByRole('alert')
      .filter({ hasText: 'Could not start authorization. Try connecting again.' })
      .waitFor();
    assert.equal(await page.getByText('private-upstream-detail', { exact: false }).count(), 0);
    await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  }
  await page.getByRole('heading', { name: 'Example consent boundary' }).waitFor();
  const authorization = new URL(page.url());
  const state = authorization.searchParams.get('state');
  assert.ok(state);
  await page.goto(
    `${origin}/api/open-sync/oauth/callback?code=example-code&state=${encodeURIComponent(state)}`,
  );
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.goto(`${origin}/syncs/${syncId}`);
  await page.getByRole('heading', { name: `${source.name} → Local SQLite`, exact: true }).waitFor();
  if (source.service === 'granola') {
    await page.getByText('connector request failed', { exact: true }).first().waitFor();
    assert.equal((await readSync({ ...input, id: syncId })).status, 'retrying');
    assert.deepEqual(await readDeliverables({ ...input, syncId }), []);
    await page.getByRole('button', { name: 'Run now', exact: true }).click();
  }
  await waitForSync({ ...input, id: syncId });
  await drainDeliveries({ ...input, syncId });
  await inspectReceivedJourney({ ...input, syncId, service: source.service, kind: source.kind });
  console.log(`${source.name}: OAuth and local delivery passed.`);
}

// A catalog fixture proves that rendering and submission depend on schemas, not destination names.
// The real backend intentionally rejects this unregistered type; its preparation is covered below the UI.
export async function destinationSetupJourney(input: Journey) {
  const { page, origin } = input;
  const pattern = '**/api/open-sync/sync/destination-types';
  const catalog = await (
    await page.request.get(`${origin}/api/open-sync/sync/destination-types`)
  ).json();
  await page.route(pattern, (route) =>
    route.fulfill({
      json: {
        types: [
          ...catalog.types,
          {
            type: 'archive',
            name: 'Archive',

            setupSchema: {
              type: 'object',
              $id: 'https://example.com/archive-setup',
              $defs: {
                project: { type: 'string', title: 'Project', minLength: 1 },
                token: { type: 'string', title: 'Archive token', minLength: 1, writeOnly: true },
                retention: { type: 'integer', title: 'Retention days', minimum: 1 },
              },
              properties: {
                project: { $ref: '#/$defs/project' },
                token: { $ref: '#/$defs/token' },
                retention: { $ref: '#/$defs/retention' },
              },
              required: ['project', 'token', 'retention'],
              additionalProperties: false,
            },
          },
        ],
      },
    }),
  );
  try {
    await page.goto(`${origin}/syncs/new?source=gmail.threads`);
    await page.getByLabel('Destination', { exact: true }).click();
    await page.getByRole('option', { name: 'Archive', exact: true }).click();
    await page.getByLabel('Archive token', { exact: true }).fill('discard-on-switch');
    await page.getByLabel('Destination', { exact: true }).click();
    await page.getByRole('option', { name: 'Local SQLite', exact: true }).click();
    assert.equal(await page.getByLabel('Archive token', { exact: true }).count(), 0);
    await page.getByLabel('Destination', { exact: true }).click();
    await page.getByRole('option', { name: 'Archive', exact: true }).click();
    assert.equal(await page.getByLabel('Archive token', { exact: true }).inputValue(), '');
    await page.getByLabel('Project', { exact: true }).fill('research');
    await page.getByLabel('Archive token', { exact: true }).fill('synthetic-archive-key');
    assert.equal(
      await page.getByLabel('Archive token', { exact: true }).getAttribute('type'),
      'password',
    );
    await page.getByLabel('Retention days', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Create sync', exact: true }).click();
    await page.getByText('Enter a valid retention days.', { exact: true }).waitFor();
    await page.getByLabel('Retention days', { exact: true }).fill('7');
    await capture({ page, name: 'destination-schema-references' });
    const submitted = page.waitForRequest(
      (request) => request.url().endsWith('/api/dashboard/syncs') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create sync', exact: true }).click();
    assert.deepEqual((await submitted).postDataJSON(), {
      source: 'gmail.threads',
      config: { history: 'All' },
      destination: {
        type: 'archive',
        input: { project: 'research', token: 'synthetic-archive-key', retention: 7 },
      },
    });
    await page
      .getByRole('alert')
      .getByText('Could not create sync. Please try again.', { exact: true })
      .waitFor();
  } finally {
    await page.unroute(pattern);
  }
}

async function historySetupJourney({ page, origin }: Journey) {
  await page.goto(`${origin}/syncs/new?source=github.pull-requests`);
  await page.getByLabel('Interval', { exact: true }).getByText('All', { exact: true }).waitFor();
  await page.getByLabel('Interval', { exact: true }).click();
  await page.getByRole('option', { name: 'Last 3 years', exact: true }).click();
  await page.getByLabel('Source', { exact: true }).click();
  await page.getByRole('option', { name: 'Slack threads', exact: true }).click();
  await page.getByLabel('Interval', { exact: true }).getByText('All', { exact: true }).waitFor();
  await page.getByLabel('Interval', { exact: true }).click();
  await page.getByRole('option', { name: 'Last 3 months', exact: true }).click();
  const submitted = page.waitForRequest(
    (request) => request.url().endsWith('/api/dashboard/syncs') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  assert.deepEqual((await submitted).postDataJSON().config, { history: 'Last 3 months' });
  await page.waitForURL(/\/syncs\/sync_/);
}

export async function syncLifecycleJourney(input: Journey & { syncId: string }) {
  const { page, origin, syncId } = input;
  const before = await readDeliverables({ ...input, syncId });
  await page.goto(`${origin}/syncs/${syncId}`);
  const queued = page.waitForResponse(`**/sync/syncs/${syncId}/resync`);
  await page.getByRole('button', { name: 'Resync', exact: true }).click();
  assert.ok((await queued).ok());
  await waitForSync({ ...input, id: syncId });
  await page
    .getByRole('list', { name: 'Polling iterations' })
    .getByRole('listitem')
    .first()
    .getByText(`${githubFixtureRecordCount} processed · ${githubFixtureRecordCount} queued`, {
      exact: true,
    })
    .waitFor();
  await capture({ page, name: 'resync-status' });
  await drainDeliveries({ ...input, syncId });
  const replayed = await readDeliverables({ ...input, syncId });
  assert.equal(replayed.length, 2 * before.length);
  const original = before.flatMap((entry) => entry.deliverable.records);
  const newlyReceived = replayed.filter(
    (entry) => !before.some((previous) => previous.deliverable.id === entry.deliverable.id),
  );
  for (const record of newlyReceived.flatMap((entry) => entry.deliverable.records)) {
    const previous = original.find((entry) => entry.id === record.id)!;
    assert.equal(record.revision, previous.revision + 1);
    assert.equal(record.operation, 'upsert');
    assert.equal(previous.operation, 'upsert');
    assert.deepEqual(record, { ...previous, revision: record.revision });
  }
  await page.goto(`${origin}/syncs/${syncId}`);
  await page.getByRole('button', { name: 'Remove sync', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await readSync({ ...input, id: syncId })).id, syncId);
  await page.getByRole('button', { name: 'Remove sync', exact: true }).click();
  await captureMobile({ page, name: 'remove-sync-mobile' });
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.waitForURL(`${origin}/syncs`);
  const missingStatus = 404;
  assert.equal(
    (await page.request.get(`${origin}/api/open-sync/sync/syncs/${syncId}`)).status(),
    missingStatus,
  );
  assert.deepEqual(await readDeliverables({ ...input, syncId }), replayed);
}

export async function githubSyncJourney(
  input: Journey & { app: { restartServer(): Promise<void> } },
) {
  const { page, origin, app } = input;
  await page.goto(`${origin}/syncs/new?source=github.pull-requests`);
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page
    .getByText('Your sync is saved. Connect your account to start syncing.', { exact: true })
    .waitFor();
  const syncId = new URL(page.url()).searchParams.get('syncId')!;
  const savedSyncUrl = page.url();
  await page.goto('about:blank');
  await app.restartServer();
  await page.goto(savedSyncUrl);
  await page
    .getByText('Your sync is saved. Connect your account to start syncing.', { exact: true })
    .waitFor();
  assert.equal(await page.getByRole('button', { name: 'API key', exact: true }).count(), 0);
  await page.goto(`${origin}/providers/github`);
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  const status = await (await page.request.get(`${origin}/api/open-sync/providers/github`)).json();
  const keyLabel = status.setup.auth.find((method: { type: string }) => method.type === 'api_key')
    .fields[0].label;
  const credential = page.getByLabel(keyLabel, { exact: true });
  assert.equal(await credential.getAttribute('type'), 'password');
  await credential.fill('invalid-test-token');
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not connect.' }).waitFor();
  await credential.fill('browser-test-github-token');
  await capture({ page, name: 'provider-api-key' });
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  const originalKeySync = await (
    await page.request.get(`${origin}/api/open-sync/sync/syncs/${syncId}`)
  ).json();
  assert.equal(originalKeySync.connection, undefined);
  assert.equal(originalKeySync.enabled, false);
  const keyAccounts = await (
    await page.request.get(`${origin}/api/open-sync/providers/github`)
  ).json();
  const keyConnection = keyAccounts.connections.find(
    (connection: { authType: string }) => connection.authType === 'api_key',
  );
  await page.goto(`${origin}/providers/github?connectionId=${keyConnection.id}`);
  await page.getByRole('heading', { name: /^Reconnect / }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'OAuth', exact: true }).count(), 0);
  await page.getByLabel(keyLabel, { exact: true }).fill('browser-test-replacement-key');
  const keyResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/providers/github/credentials') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Reconnect account', exact: true }).click();
  assert.ok((await keyResponse).ok());
  const refreshedKeySync = await (
    await page.request.get(`${origin}/api/open-sync/sync/syncs/${syncId}`)
  ).json();
  assert.deepEqual(refreshedKeySync.connection, originalKeySync.connection);
  assert.equal(refreshedKeySync.id, originalKeySync.id);
  const accountId = await githubOAuthSuccessJourney({ page, origin: origin });
  await page.goto(`${origin}/syncs/${syncId}`);
  await waitForSync({ ...input, id: syncId });
  await page.getByRole('list', { name: 'Polling iterations' }).getByRole('listitem').waitFor();
  await capture({ page, name: 'sync-detail' });
  for (const name of ['Queue', 'Records', 'Assets']) {
    assert.equal(await page.getByRole('link', { name, exact: true }).count(), 0);
  }
  await page.getByRole('link', { name: 'Pending deliverables', exact: true }).click();
  const pending = page.getByRole('list', { name: 'Pending deliverables' }).getByRole('listitem');
  const pageSize = 20;
  await pending.nth(pageSize - 1).waitFor();
  assert.equal(await pending.count(), pageSize);
  await pending.last().scrollIntoViewIfNeeded();
  await pending.nth(githubFixtureRecordCount - 1).waitFor();
  assert.equal(await pending.count(), githubFixtureRecordCount);
  await pending.filter({ hasText: 'browser fixture blocked' }).waitFor();
  const blocked = pending.filter({ hasText: 'browser fixture blocked' });
  await blocked.getByRole('link').click();
  await page.locator('pre').getByText('"title": "PR 000"', { exact: false }).waitFor();
  await capture({ page, name: 'pending-deliverable' });
  await page.goto(`${origin}/syncs/${syncId}?view=pending`);
  await pending.nth(pageSize - 1).waitFor();
  await pending.last().scrollIntoViewIfNeeded();
  await pending
    .filter({ hasText: 'browser fixture blocked' })
    .getByRole('button', { name: 'Retry', exact: true })
    .click();
  await drainDeliveries({ ...input, syncId });
  await page.getByText('No pending deliverables.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Received deliverables', exact: true }).click();
  const received = page.getByRole('list', { name: 'Received deliverables' }).getByRole('listitem');
  await received.nth(pageSize - 1).waitFor();
  assert.equal(await received.count(), pageSize);
  await received.last().scrollIntoViewIfNeeded();
  await received.nth(githubFixtureRecordCount - 1).waitFor();
  assert.equal(await received.count(), githubFixtureRecordCount);
  await received.first().getByRole('link').click();
  await page.locator('pre').getByText('"kind": "pull-request"', { exact: false }).waitFor();
  await capture({ page, name: 'received-deliverable' });
  const activated = await readSync({ ...input, id: syncId });
  await page.goto(`${origin}/providers/github`);
  await githubOAuthReconnectJourney({
    page,
    origin,
    connectionId: activated.connection!.id,
    accountId,
  });
  const reconnected = await readSync({ ...input, id: syncId });
  assert.deepEqual(reconnected.connection, activated.connection);
  return syncId;
}
