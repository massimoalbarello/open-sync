import { getConnectorBuildOptions } from '@oomol-lab/open-connector/build';
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
export function getOpenSyncBuildOptions(options: { providers: readonly string[] }) {
  return getConnectorBuildOptions(options);
}
