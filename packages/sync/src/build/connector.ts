import { access, cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BunPlugin } from 'bun';

// This adapter deliberately supports one published layout. Review it when upgrading Connector.
const supportedVersion = '1.6.0';
const indexVersion = 1;
interface CatalogEntry {
  file: string;
  bytes: number;
  provider: { service: string };
}

function unsupported(detail: string): never {
  throw new Error(
    `Unsupported Open Connector package: ${detail}. Review the Open Sync build adapter.`,
  );
}

/** Parse only the pinned generator's format; never evaluate dependency code during preparation. */
function executorRegistry(source: string): Map<string, string> {
  const lines = source.trim().split('\n');
  if (
    lines.shift() !== '/** Generated lazy imports for provider executors. Do not hand-edit. */' ||
    lines.shift() !== 'export const executorModules = {' ||
    lines.pop() !== '};'
  ) {
    unsupported('executor registry format changed');
  }
  const modules = new Map<string, string>();
  for (const line of lines) {
    const match =
      /^ {4}(?:"([\w-]+)"|([\w]+)): \(\) => import\("(\.\/[\w-]+\/executors\.js)"\),$/.exec(line);
    const service = match?.[1] ?? match?.[2];
    const path = match?.[3];
    if (!service || path !== `./${service}/executors.js` || modules.has(service)) {
      unsupported('executor registry entry changed');
    }
    modules.set(service, path);
  }
  return modules;
}

function catalogEntries(value: unknown): CatalogEntry[] {
  const index = value as { version?: unknown; providers?: CatalogEntry[] } | null;
  if (index?.version !== indexVersion || !Array.isArray(index.providers)) {
    unsupported('catalog index format changed');
  }
  const services = new Set<string>();
  for (const entry of index.providers) {
    const service = entry?.provider?.service;
    if (
      typeof service !== 'string' ||
      !/^[\w-]+$/.test(service) ||
      entry.file !== `${service}.json` ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0 ||
      services.has(service)
    ) {
      unsupported('catalog index entry changed');
    }
    services.add(service);
  }
  return index.providers;
}

/** All knowledge of Connector's private package layout stays behind this build adapter. */
export async function prepareConnector(input: {
  root: string;
  providers: readonly string[];
  assets: string;
}): Promise<BunPlugin> {
  const root = await realpath(input.root);
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (metadata.name !== '@oomol-lab/open-connector' || metadata.version !== supportedVersion) {
    unsupported(
      `expected @oomol-lab/open-connector ${supportedVersion}, found ${metadata.version}`,
    );
  }
  const registry = join(root, 'src/providers/registry.generated.js');
  const modules = executorRegistry(await readFile(registry, 'utf8'));
  const sourceAssets = join(root, 'assets/open-connector');
  const entries = catalogEntries(
    JSON.parse(await readFile(join(sourceAssets, 'catalog/apps-index.json'), 'utf8')),
  );
  const selected = input.providers.map((service) => {
    const entry = entries.find((item) => item.provider.service === service);
    if (!entry || !modules.has(service)) {
      throw new Error(
        `Cannot bundle Open Connector provider ${JSON.stringify(service)}: catalog or executor is missing.`,
      );
    }
    return entry;
  });
  await mkdir(join(input.assets, 'catalog/apps'), { recursive: true });
  for (const entry of selected) {
    await access(join(root, 'src/providers', modules.get(entry.provider.service)!));
    const content = await readFile(join(sourceAssets, 'catalog/apps', entry.file));
    if (
      content.byteLength !== entry.bytes ||
      JSON.parse(content.toString()).service !== entry.provider.service
    ) {
      unsupported(`catalog file does not match its index: ${entry.file}`);
    }
    await writeFile(join(input.assets, 'catalog/apps', entry.file), content);
  }
  if (!selected.length) {
    // Bun embeds files, so retain the directory that Connector enumerates even with zero providers.
    await writeFile(join(input.assets, 'catalog/apps/empty'), '');
  }
  await writeFile(
    join(input.assets, 'catalog/apps-index.json'),
    JSON.stringify({ version: indexVersion, providers: selected }),
  );
  await cp(join(sourceAssets, 'migrations'), join(input.assets, 'migrations'), { recursive: true });
  const contents = `export const executorModules = {\n${selected
    .map(
      ({ provider }) =>
        `${JSON.stringify(provider.service)}: () => import(${JSON.stringify(modules.get(provider.service))}),`,
    )
    .join('\n')}\n};`;
  return {
    name: 'open-sync-providers',
    setup(build) {
      let replaced = false;
      build.onStart(() => {
        replaced = false;
      });
      build.onLoad({ filter: /[/\\]providers[/\\]registry\.generated\.js$/ }, ({ path }) => {
        if (path !== registry) {
          return;
        }
        replaced = true;
        return { contents, loader: 'js' };
      });
      build.onEnd((result) => {
        if (result.success && !replaced) {
          unsupported('the build did not load the expected executor registry');
        }
      });
    },
  };
}
