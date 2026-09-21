import assert from 'node:assert/strict';
import type { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

type Page = Awaited<ReturnType<typeof virtualPasskeyBrowser>>['page'];

// A catalog fixture proves that rendering and submission depend on schemas, not destination names.
// The real backend intentionally rejects this unregistered type; its preparation is covered below the UI.
export async function destinationSetupJourney(input: { page: Page; origin: string }) {
  const { page, origin } = input;
  const pattern = '**/api/open-sync/sync/destination-types';
  await page.route(pattern, (route) =>
    route.fulfill({
      json: {
        types: [
          {
            type: 'archive',
            name: 'Archive',
            version: '1',
            configSchema: {},
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
    await page.screenshot({
      path: 'artifacts/destination-schema-references.png',
      fullPage: true,
      animations: 'disabled',
    });
    const submitted = page.waitForRequest(
      (request) => request.url().endsWith('/api/dashboard/syncs') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create sync', exact: true }).click();
    assert.deepEqual((await submitted).postDataJSON(), {
      source: 'gmail.threads',
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
  // Authoritative validation rejects both invalid destination settings and malformed envelopes safely.
  const before = await (await page.request.get(`${origin}/api/open-sync/sync/destinations`)).json();
  for (const settings of [
    { endpoint: 'http://receiver.example', apiKey: 'synthetic-secret' },
    ['synthetic-secret'],
  ]) {
    const rejected = await page.request.post(`${origin}/api/dashboard/syncs`, {
      data: { source: 'gmail.threads', destination: { type: 'http', input: settings } },
      headers: { origin },
    });
    assert.ok(!rejected.ok());
    assert.ok(!(await rejected.text()).includes('synthetic-secret'));
  }
  assert.deepEqual(
    await (await page.request.get(`${origin}/api/open-sync/sync/destinations`)).json(),
    before,
  );
}
