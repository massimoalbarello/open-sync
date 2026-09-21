import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenSyncBuildOptions, providersFromDefinitions } from '../src/build';
import { fixture } from './support';

test('provider selection derives only declared dependencies without loading sync logic', () => {
  const registration = (service: string) => ({
    definition: { ...fixture.definition, provider: { service, actions: [] } },
    load() {
      throw new Error('Build preparation must not load sync executables');
    },
  });
  expect(
    providersFromDefinitions([
      fixture,
      registration('slack'),
      registration('github'),
      registration('slack'),
    ]),
  ).toEqual(['github', 'slack']);
  expect(providersFromDefinitions([])).toEqual([]);
});

test('selected catalogs are deduplicated, retain schemas, and are removed on disposal', async () => {
  const build = await getOpenSyncBuildOptions({ providers: ['slack', 'github', 'slack'] });
  const assets = build.assets[0]!;
  try {
    expect((await readdir(join(assets, 'catalog/apps'))).sort()).toEqual([
      'github.json',
      'slack.json',
    ]);
    const index = await Bun.file(join(assets, 'catalog/apps-index.json')).json();
    expect(
      index.providers.map((entry: { provider: { service: string } }) => entry.provider.service),
    ).toEqual(['github', 'slack']);
    for (const entry of index.providers) {
      const content = await readFile(join(assets, 'catalog/apps', entry.file));
      expect(content.byteLength).toBe(entry.bytes);
      expect(
        JSON.parse(content.toString()).actions.some(
          (action: { inputSchema: unknown }) => action.inputSchema !== null,
        ),
      ).toBe(true);
    }
    expect((await readdir(join(assets, 'migrations'))).some((file) => file.endsWith('.sql'))).toBe(
      true,
    );
  } finally {
    await build.dispose();
  }
  await expect(readdir(assets)).rejects.toThrow();
  await build.dispose();
});

test('unknown providers fail preparation instead of falling back to the complete catalog', async () => {
  await expect(getOpenSyncBuildOptions({ providers: ['not-a-provider'] })).rejects.toThrow(
    'Unknown provider: not-a-provider',
  );
});
