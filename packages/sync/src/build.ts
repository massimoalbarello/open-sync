import { getConnectorAssetDirectory } from '@oomol-lab/open-connector';

/** Options needed when a host embeds Open Sync in a Bun executable. */
export function getOpenSyncBuildOptions() {
  return { assets: [getConnectorAssetDirectory()], external: ['proxy-agent'] };
}
