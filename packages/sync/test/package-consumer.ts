// Copied into an isolated consumer by the package check; imports must resolve from the tarball.

import { createOpenSync, type OpenSyncOptions } from '@context-use/open-sync';
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

    configSchema: { type: 'object' },
    checkpointSchema: { type: 'integer' },
    initialCheckpoint: 0,
    kinds: { item: { type: 'object' } },
    provider: { service: 'github', actions: ['github.get_current_user'], proxyPaths: ['/user'] },
  },
  load: () => ({
    async step({ provider }) {
      const user = await provider.get({ path: '/user' });
      if (user.status !== okStatus) {
        throw new Error('Provider request failed');
      }
      const profile = await provider.action({ id: 'github.get_current_user', input: {} });
      return {
        checkpoint: 1,
        complete: true,
        deliverable: {
          records: [
            { operation: 'upsert', kind: 'item', id: 'one', data: { user: user.body, profile } },
          ],
        },
      };
    },
  }),
};
const received: Delivery[] = [];
const scope = { actorId: 'consumer', ownerId: 'consumer' };
const options: OpenSyncOptions = {
  dataDirectory: './consumer-state',
  publicUrl: 'http://host/embedded',
  authorize: () => scope,
  canConfigureProviders: () => Promise.resolve(true),
  definitions: [definition],
  destinationTypes: {
    local: {
      configSchema: { type: 'object' },
      deliver: ({ delivery }) => {
        received.push(delivery);
        return Promise.resolve({ status: 'accepted' });
      },
    },
  },
};
if (Bun.isStandaloneExecutable) {
  const catalogFiles = Bun.embeddedFiles
    .map((file) => (file as Blob & { name: string }).name)
    .filter((name) => name?.includes('/catalog/apps/') && name.endsWith('.json'));
  const expected = process.argv[2] === 'empty' ? [] : ['github.json'];
  if (
    JSON.stringify(catalogFiles.map((name) => name!.split('/').at(-1)).sort()) !==
    JSON.stringify(expected)
  ) {
    throw new Error(`Unexpected embedded catalog files: ${catalogFiles.join(', ')}`);
  }
  // A missing provider must fail startup and release Connector so the next start can succeed.
  const unavailable = {
    ...definition,
    definition: { ...definition.definition, provider: { service: 'slack', actions: [] } },
  };
  try {
    const unexpected = await createOpenSync({ ...options, definitions: [unavailable] });
    await unexpected.close();
    throw new Error('A missing provider was accepted');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('Include it in getOpenSyncBuildOptions')
    ) {
      throw error;
    }
  }
}
const empty = process.argv[2] === 'empty';
const sync = await createOpenSync({ ...options, definitions: empty ? [] : [definition] });
try {
  if (empty) {
    if ((await sync.providers.catalog(scope)).length) {
      throw new Error('An empty selection exposed providers');
    }
    console.log('Installed Open Sync runs with no bundled providers.');
  } else {
    await sync.providers.configure({
      ...scope,
      service: 'github',
      values: { clientId: 'test-client', clientSecret: 'test-secret' },
    });
    const authorization = await sync.providers.start({
      ...scope,
      service: 'github',
      authorizationOptionIds: ['read:user'],
    });
    const authorizationUrl = new URL(authorization.authorizationUrl);
    if (
      authorizationUrl.origin !== 'https://github.com' ||
      authorizationUrl.searchParams.get('redirect_uri') !== 'http://host/embedded/oauth/callback'
    ) {
      throw new Error('Selected provider OAuth configuration was not packaged');
    }
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
    const destination = { type: 'local', input: {} };
    await sync.api.createSync({
      ...scope,
      destination,
      config: {},
      definition: definition.definition.id,
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
    if (
      Bun.isStandaloneExecutable &&
      JSON.stringify((await sync.providers.catalog(scope)).map((entry) => entry.service)) !==
        JSON.stringify(['github'])
    ) {
      throw new Error('Compiled catalog did not match the selected provider');
    }
    console.log(
      'Installed Open Sync manages providers and delivers directly to an independent host.',
    );
  }
} finally {
  await sync.close();
  globalThis.fetch = providerFetch;
}
