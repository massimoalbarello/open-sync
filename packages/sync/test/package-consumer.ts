// Copied into an isolated consumer by the package check; imports must resolve from the tarball.

import { createOpenSync } from '@context-use/open-sync';
import type { SyncRegistration } from '@context-use/open-sync/definition';
import type { Delivery } from '@context-use/open-sync/delivery';

// Keep the installed provider runtime and credential persistence real; simulate only GitHub.
const providerFetch = globalThis.fetch;
const okStatus = 200;
globalThis.fetch = Object.assign((input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== 'https://api.github.com/user') {
    return Promise.reject(new Error(`Unexpected provider request: ${url}`));
  }
  return Promise.resolve(Response.json({ id: 123, login: 'package-test' }));
}, providerFetch);

let connectorExported = false;
try {
  import.meta.resolve('@context-use/open-sync/connector');
  connectorExported = true;
} catch {
  // Connector composition is private, including when installed from the published package.
}
if (connectorExported) {
  throw new Error('The installed package exposes Connector internals');
}

const definition: SyncRegistration = {
  definition: {
    id: 'package-test',
    version: '1',
    artifactId: 'package-test/1',
    configSchema: { type: 'object' },
    checkpointSchema: { type: 'integer' },
    initialCheckpoint: 0,
    kinds: { item: { type: 'object' } },
    provider: { service: 'github', actions: [], proxyPaths: ['/user'] },
  },
  load: () => ({
    async *run({ provider }) {
      const user = await provider.get({ path: '/user' });
      if (user.status !== okStatus) {
        throw new Error('Provider request failed');
      }
      yield {
        checkpoint: 1,
        complete: true,
        deliverable: {
          records: [{ operation: 'upsert', kind: 'item', id: 'one', data: { user: user.body } }],
        },
      };
    },
  }),
};
const received: Delivery[] = [];
const scope = { actorId: 'consumer', ownerId: 'consumer' };
const sync = await createOpenSync({
  dataDirectory: './consumer-state',
  publicUrl: 'http://host/embedded',
  authorize: () => scope,
  canConfigureProviders: () => Promise.resolve(true),
  definitions: [definition],
  destinationTypes: {
    local: {
      version: '1',
      configSchema: { type: 'object' },
      deliver: ({ delivery }) => {
        received.push(delivery);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  },
});
try {
  await sync.providers.credentials({
    ...scope,
    service: 'github',
    authType: 'api_key',
    values: { apiKey: 'synthetic-token' },
  });
  const [connection] = await sync.providers.connections(scope);
  if (!connection) {
    throw new Error('Provider connection was not created');
  }
  const destination = sync.api.createDestination({ ...scope, type: 'local', config: {} });
  await sync.api.createInstallation({
    ...scope,
    destinationId: destination.id,
    config: {},
    definition: definition.definition,
    connection: { id: connection.id, service: connection.service },
  });
  sync.start();
  const timeoutMs = 5000;
  const pollMs = 20;
  const deadline = Date.now() + timeoutMs;
  while (
    (!received.length || sync.api.status(scope).queue.pendingRecords) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(pollMs);
  }
  if (received.length !== 1 || sync.api.status(scope).queue.pendingRecords !== 0) {
    throw new Error('Independent consumer did not receive its record');
  }
  const catalog = await sync.fetch(new Request('http://host/embedded/providers'));
  if (
    !catalog.ok ||
    !((await catalog.json()) as { service: string }[]).some((item) => item.service === 'github')
  ) {
    throw new Error('Independent host cannot discover provider authentication through Open Sync');
  }
  console.log(
    'Installed Open Sync manages providers and delivers directly to an independent host.',
  );
} finally {
  await sync.close();
  globalThis.fetch = providerFetch;
}
