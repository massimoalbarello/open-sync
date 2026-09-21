import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { assetsEmptyJourney, assetsJourney, resumeAssetDelivery } from './assets-journey';
import { copyAuthorizationJourney } from './copy-authorization-journey';
import { destinationSetupJourney } from './destination-setup-journey';
import { historySetupJourney } from './history-setup-journey';
import { previewsJourney } from './previews-journey';
import { providerSetupJourney } from './provider-setup-journey';
import { sourceRetryJourney } from './source-retry-journey';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];
const successStatus = 200;
const notFoundStatus = 404;
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
  await assetsEmptyJourney(input);
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
  if (source.service === 'gmail') {
    await page.goto(`${origin}/delivery`);
    await page.getByRole('button', { name: 'Pause delivery', exact: true }).click();
    await page.getByRole('button', { name: 'Resume delivery', exact: true }).waitFor();
  }
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
  if (source.service === 'slack') {
    await sourceRetryJourney({ page, origin, syncId });
  }
  await page.getByRole('cell', { name: 'Completed', exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  const installation = await (
    await page.request.get(`${origin}/api/open-sync/sync/installations/${syncId}`)
  ).json();
  if (source.service === 'gmail') {
    await resumeAssetDelivery({ page, origin, sourceId: installation.sourceId });
  }
  await verifyRecords({ ...input, sourceId: installation.sourceId });
  console.log(`${source.name}: OAuth and local delivery passed.`);
}

async function verifyRecords(input: {
  page: Page;
  origin: string;
  source: (typeof sources)[number];
  sourceId: string;
}) {
  const { page, origin, source, sourceId } = input;
  await page.goto(`${origin}/records?sourceId=${encodeURIComponent(sourceId)}`);
  await page
    .getByRole('list', { name: 'Received records' })
    .getByRole('listitem')
    .first()
    .waitFor({ timeout: 180_000 });
  const records = await (
    await page.request.get(
      `${origin}/api/receiver/records?offset=0&sourceId=${encodeURIComponent(sourceId)}`,
    )
  ).json();
  assert.equal(records.records[0].kind, source.kind);
  if (source.service === 'gmail') {
    const receivedAttachments = records.records[0].data.messages[0].attachments;
    const attachmentCount = 3;
    assert.equal(receivedAttachments.length, attachmentCount);
    assert.deepEqual(receivedAttachments[2], {
      name: 'oversized.bin',
      file: { status: 'failed', code: 'asset_too_large' },
    });
    const attachments = receivedAttachments.slice(0, 2) as {
      name: string;
      file: string;
    }[];
    assert.equal(attachments.length, 2);
    assert.notEqual(attachments[0]!.file, attachments[1]!.file);
    assert.deepEqual(
      records.records[0].assets.map((asset: { id: string }) => asset.id).sort(),
      records.records[0].data.messages
        .flatMap(
          (message: { attachments?: { file: unknown }[] }) =>
            message.attachments?.map((attachment) => attachment.file) ?? [],
        )
        .filter((file: unknown): file is string => typeof file === 'string')
        .sort(),
    );
    await assetsJourney({ page, origin, sourceId, attachments });
    await previewsJourney({ page, origin, record: records.records[0] });
    const expected = ['inline attachment', 'external attachment'];
    for (const [index, attachment] of attachments.entries()) {
      const response = await page.request.get(`${origin}/api/receiver/assets/${attachment.file}`);
      assert.equal(response.status(), successStatus);
      assert.equal(await response.text(), expected[index]);
      assert.match(response.headers()['content-disposition']!, /^attachment;/);
    }
    assert.equal(
      (
        await page.request.get(
          `${origin}/api/receiver/assets/asset_00000000-0000-0000-0000-000000000000`,
        )
      ).status(),
      notFoundStatus,
    );
  }
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
    await page.goto(`${origin}/records?sourceId=${encodeURIComponent(sourceId)}`);
    await page
      .getByRole('list', { name: 'Received records' })
      .getByRole('link', { name: `${source.kind} · ${records.records[0].id}`, exact: true })
      .click();
    await page.locator('pre').getByText('"messages":', { exact: false }).waitFor();
    await page.screenshot({
      path: `artifacts/${source.service}-thread-record.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
}
