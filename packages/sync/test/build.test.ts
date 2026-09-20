import { expect, test } from 'bun:test';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOpenSyncBuildOptions, providersFromDefinitions } from '../src/build';
import { prepareConnector } from '../src/build/connector';
import { fixture, storage } from './support';

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
    'catalog or executor is missing',
  );
});

test('the build fails if its plugin never replaces the expected Connector registry', async () => {
  const files = storage();
  const prepared = await getOpenSyncBuildOptions({ providers: [] });
  try {
    const entrypoint = join(files.dir, 'unrelated.ts');
    await writeFile(entrypoint, 'console.log("no connector");');
    await expect(
      Bun.build({
        entrypoints: [entrypoint],
        plugins: prepared.plugins,
        target: 'bun',
      }),
    ).rejects.toThrow('the build did not load the expected executor registry');
  } finally {
    await prepared.dispose();
    files.close();
  }
});

test('dependency upgrades and changed registry or catalog formats fail closed', async () => {
  const files = storage();
  const installed = dirname(
    dirname(dirname(fileURLToPath(import.meta.resolve('@oomol-lab/open-connector')))),
  );
  const root = join(files.dir, 'connector');
  const registry = join(root, 'src/providers/registry.generated.js');
  const packageFile = join(root, 'package.json');
  const indexFile = join(root, 'assets/open-connector/catalog/apps-index.json');
  const prepare = () =>
    prepareConnector({ root, providers: ['github'], assets: join(files.dir, 'staged') });
  try {
    await mkdir(join(root, 'src/providers'), { recursive: true });
    await writeFile(
      packageFile,
      JSON.stringify({ name: '@oomol-lab/open-connector', version: '2.0.0' }),
    );
    await expect(prepare()).rejects.toThrow('expected @oomol-lab/open-connector 1.6.0');
    await cp(join(installed, 'package.json'), packageFile);
    await writeFile(registry, 'export const executorModules = {};');
    await expect(prepare()).rejects.toThrow('executor registry format changed');
    await cp(join(installed, 'src/providers/registry.generated.js'), registry);
    await mkdir(dirname(indexFile), { recursive: true });
    await writeFile(indexFile, JSON.stringify({ version: 2, providers: [] }));
    await expect(prepare()).rejects.toThrow('catalog index format changed');
    await writeFile(
      indexFile,
      JSON.stringify({
        version: 1,
        providers: [{ file: '../github.json', bytes: 0, provider: { service: 'github' } }],
      }),
    );
    await expect(prepare()).rejects.toThrow('catalog index entry changed');
  } finally {
    files.close();
  }
});
