import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { destinationSetupJourney } from './destination-setup-journey';

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
  const { page, origin } = input;
  await destinationSetupJourney(input);
  await page.goto(`${origin}/sources`);
  await page.getByRole('heading', { name: 'Granola meetings', exact: true }).waitFor();
  await page.screenshot({
    path: 'artifacts/example-sources.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(`${origin}/syncs/new?source=gmail.threads`);
  await page.getByLabel('Destination', { exact: true }).click();
  await page.getByRole('option', { name: 'External API', exact: true }).click();
  await page.getByLabel('API key', { exact: true }).fill('discard-on-switch');
  await page.getByLabel('Destination', { exact: true }).click();
  await page.getByRole('option', { name: 'Local SQLite', exact: true }).click();
  assert.equal(await page.getByLabel('API key', { exact: true }).count(), 0);
  await page.getByLabel('Destination', { exact: true }).click();
  await page.getByRole('option', { name: 'External API', exact: true }).click();
  assert.equal(await page.getByLabel('API key', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.getByText('Endpoint URL is required.', { exact: true }).waitFor();
  await page.getByLabel('Endpoint URL', { exact: true }).fill('https://receiver.example/records');
  await page.getByLabel('API key', { exact: true }).fill('synthetic-destination-key');
  assert.equal(await page.getByLabel('API key', { exact: true }).getAttribute('type'), 'password');
  await page.screenshot({
    path: 'artifacts/external-api-destination.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Create sync', exact: true }).click();
  await page.waitForURL(/\/syncs\/sync_/);
  await page.goto(`${origin}/delivery`);
  await page.getByText('blocked · http 401', { exact: true }).waitFor();
  await page.goto(`${origin}/destinations`);
  await page.getByRole('heading', { name: 'External API', exact: true }).waitFor();
  await page.screenshot({
    path: 'artifacts/example-destinations.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/syncs/new?source=granola.meetings&destination=http`);
  await page.getByLabel('Endpoint URL').waitFor();
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await page.screenshot({
    path: 'artifacts/external-api-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  console.log(
    'Example journeys passed: Gmail OAuth, Slack OAuth, Granola OAuth/MCP, local records and external API rejection.',
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
  await page.getByLabel('Client ID', { exact: true }).fill(`fixture-${source.service}`);
  if (source.service !== 'granola') {
    await page.getByLabel('Client secret', { exact: true }).fill('fixture-client-secret');
  }
  await page.getByRole('button', { name: 'Save OAuth app', exact: true }).click();
  await page.getByRole('button', { name: 'Edit OAuth app', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByRole('heading', { name: 'Example consent boundary' }).waitFor();
  const authorization = new URL(page.url());
  assert.equal(authorization.searchParams.get('client_id'), `fixture-${source.service}`);
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
  await page.getByText('succeeded → Local SQLite', { exact: true }).waitFor();
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
