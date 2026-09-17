// Executed outside the workspace against three installed tarballs, with no default app imports.
import { createSyncRuntime } from '@open-sync/core/engine';
import { createMarkdownWebhook } from '@open-sync/examples/destinations/markdown-webhook';
import { githubPullRequests } from '@open-sync/examples/syncs/github-markdown';
import { githubFixture } from './github-fixture';

const scope = { actorId: 'independent-host', ownerId: 'independent-host' };
const github = githubFixture();
const received: string[] = [];
const receiver = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    received.push(await request.text());
    return new Response(null, { status: 204 });
  },
});
const runtime = createSyncRuntime({
  databasePath: './example-consumer.sqlite',
  definitions: [githubPullRequests],
  connector: { bind: () => Promise.resolve(github.context.provider) },
  destinationTypes: { webhook: createMarkdownWebhook({ endpoint: receiver.url.href }) },
});
try {
  const destination = runtime.api.createDestination({ ...scope, type: 'webhook', config: {} });
  await runtime.api.createInstallation({
    ...scope,
    destinationId: destination.id,
    definition: githubPullRequests.definition,
    connection: { id: 'github-account', service: 'github' },
    config: { scope: 'authored' },
    intervalMs: 900_000,
  });
  await runtime.tick();
  await runtime.tick();
  if (
    received.length !== 1 ||
    !received[0]?.includes('Thread 50') ||
    runtime.api.status(scope).queue.pendingRecords !== 0
  ) {
    throw new Error('Installed examples did not deliver a complete PR to the independent host');
  }
  console.log(
    'Installed GitHub and webhook examples work without importing the default host or engine internals.',
  );
} finally {
  await runtime.close();
  await receiver.stop(true);
}
