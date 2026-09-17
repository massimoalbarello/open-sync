import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DestinationType } from '@open-sync/core/delivery';
import { createSyncRuntime } from '@open-sync/core/engine';
import { githubPullRequests } from '@open-sync/example-integrations/github';
import { githubFixture } from './github-fixture';

export const owner = { actorId: 'author', ownerId: 'author' };
export async function engineFixture(destination: DestinationType) {
  const directory = mkdtempSync(join(tmpdir(), 'open-sync-examples-'));
  const github = githubFixture();
  const options = {
    databasePath: join(directory, 'sync.sqlite'),
    definitions: [githubPullRequests],
    destinationTypes: { example: destination },
    connector: { bind: () => Promise.resolve(github.context.provider) },
  };
  let engine = createSyncRuntime(options);
  const target = engine.api.createDestination({ ...owner, type: 'example', config: {} });
  const installation = await engine.api.createInstallation({
    ...owner,
    definition: githubPullRequests.definition,
    destinationId: target.id,
    connection: { id: 'authorized-github', service: 'github' },
    config: { scope: 'authored' },
    intervalMs: 900_000,
  });
  return {
    ...github,
    installation,
    get engine() {
      return engine;
    },
    async restart() {
      await engine.close();
      engine = createSyncRuntime(options);
    },
    async close() {
      await engine.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
