import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { copyAuthorizationJourney } from './copy-authorization-journey';
import { destinationSetupJourney } from './destination-setup-journey';
import { historySetupJourney } from './history-setup-journey';
import { providerSetupJourney } from './provider-setup-journey';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
const sources = [
  {
    service: 'gmail',
    name: 'Gmail threads',
    kind: 'thread',
    authorization: 'https://accounts.google.com/o/oauth2/v2/auth**',
  },
  {
    service: 'slack',
    name: 'Slack threads',
    kind: 'thread',
    authorization: 'https://slack.com/oauth/v2_user/authorize**',
  },
  {
    service: 'granola',
    name: 'Granola meetings',
    kind: 'meeting',
    authorization: 'https://mcp-auth.granola.ai/oauth2/authorize**',
  },
];

export async function exampleSyncsJourney(input: { page: Page; origin: string }) {
  for (const source of sources) {
    await connectSource({ ...input, source });
  }
  await historySetupJourney(input);
  await destinationSetupJourney(input);
  await providerSetupJourney(input);
  console.log(
    'Example journeys passed: Gmail OAuth, Slack OAuth, Granola OAuth/MCP, and local records.',
  );
}

async function connectSource(input: {
  page: Page;
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
  await page.goto(`${origin}/syncs/new`);
  await page.getByLabel('Source', { exact: true }).click();
  await page.getByRole('option', { name: source.name, exact: true }).click();
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page
    .getByText('Your sync is saved. Connect your account to start syncing.', { exact: true })
    .waitFor();
  const syncId = new URL(page.url()).searchParams.get('syncId')!;
  assert.equal(await page.getByRole('button', { name: 'API key', exact: true }).count(), 0);
  if (source.service === 'granola') {
    assert.equal(await page.getByLabel('Client ID', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Client secret', { exact: true }).count(), 0);
    await page.screenshot({
      path: 'artifacts/granola-connect.png',
      fullPage: true,
      animations: 'disabled',
    });
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
  assert.equal(
    authorization.searchParams.get('client_id'),
    source.service === 'granola' ? 'dynamically-registered-granola' : `fixture-${source.service}`,
  );
  if (source.service === 'granola') {
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authorization.searchParams.get('code_challenge'));
  }
  assert.equal(
    authorization.searchParams.get('redirect_uri'),
    `${origin}/api/open-sync/oauth/callback`,
  );
  const state = authorization.searchParams.get('state');
  assert.ok(state);
  await page.goto(
    `${origin}/api/open-sync/oauth/callback?code=example-code&state=${encodeURIComponent(state)}`,
  );
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.goto(`${origin}/syncs/${syncId}`);
  await page.getByRole('heading', { name: `${source.name} → Local SQLite`, exact: true }).waitFor();
  await page.getByRole('link', { name: 'Polling history', exact: true }).click();
  await page.getByRole('cell', { name: 'Completed', exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  const installation = await (
    await page.request.get(`${origin}/api/open-sync/sync/installations/${syncId}`)
  ).json();
  await page.goto(`${origin}/records?sourceId=${encodeURIComponent(installation.sourceId)}`);
  await page
    .getByRole('list', { name: 'Received records' })
    .getByRole('listitem')
    .first()
    .waitFor({ timeout: 180_000 });
  const records = await (
    await page.request.get(
      `${origin}/api/receiver/records?offset=0&sourceId=${encodeURIComponent(installation.sourceId)}`,
    )
  ).json();
  assert.equal(records.records[0].kind, source.kind);
  assert.ok(!JSON.stringify(records).includes('fixture-token'));
  if (source.kind === 'thread') {
    assert.equal(records.records.length, 1);
    assert.deepEqual(
      records.records[0].data.messages.map((message: { body: string }) => message.body),
      source.service === 'gmail'
        ? ['Meet at noon?', 'Yes, see you there!']
        : ['Lunch?', 'At noon?', 'See you there!'],
    );
    if (source.service === 'slack') {
      assert.equal(records.records[0].data.messages[0].sentAt, '2020-01-01T12:00:00.000Z');
    }
    await page.locator('summary').first().click();
    await page.locator('pre').getByText('"messages":', { exact: false }).waitFor();
    await page.screenshot({
      path: `artifacts/${source.service}-thread-record.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  console.log(`${source.name}: OAuth and local delivery passed.`);
}
