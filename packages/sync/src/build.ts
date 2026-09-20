import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareConnector } from './build/connector';
import type { SyncRegistration } from './models/definition';

/** Provider dependencies declared by registrations, without loading their sync executables. */
export function providersFromDefinitions(definitions: readonly SyncRegistration[]): string[] {
  return [
    ...new Set(
      definitions.flatMap(({ definition }) =>
        definition.provider ? [definition.provider.service] : [],
      ),
    ),
  ].sort();
}

/**
 * Prepare selected providers for a Bun executable. Pass plugins/external to Bun.build and assets
 * to compile.assets. Await dispose() after the build (also on failure); it removes staged files.
 * An empty provider list packages no providers. The installed dependency is never modified.
 */
export async function getOpenSyncBuildOptions(options: { providers: readonly string[] }) {
  const directory = await mkdtemp(join(tmpdir(), 'open-sync-build-'));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const entrypoint = fileURLToPath(import.meta.resolve('@oomol-lab/open-connector'));
    const assets = join(directory, 'open-connector');
    const plugin = await prepareConnector({
      root: dirname(dirname(dirname(entrypoint))),
      providers: [...new Set(options.providers)].sort(),
      assets,
    });
    return { assets: [assets], external: ['proxy-agent'], plugins: [plugin], dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
