import type { ProviderGateway } from '../execution/provider';
import type { ConnectionRef, ProviderOperations, ProviderRequirements } from '../models/definition';
import { fail } from '../models/error';
import type { Scope } from '../models/identity';
import type { JsonObject, JsonValue } from '../models/json';
import { matchesProviderPath } from '../models/provider-path';
import { connectorFailure } from './failure';
import { downloadFile } from './file';
import { connectorData, providerResponse } from './response';

interface RequestInput {
  service: string;
  operation: string;
  path: string;
  admin?: boolean;
  body?: JsonObject;
  alias?: string;
  signal: AbortSignal;
}
interface ConnectorClientOptions {
  /** Borrowed embedded Connector transport; the Open Sync facade owns its lifetime. */
  fetch(request: Request): Promise<Response>;
  baseUrl: string;
  adminToken: string;
  runtimeToken: string;
  /** The facade checks ownership before any privileged metadata read. */
  authorizeConnection(input: Scope & { connection: ConnectionRef }): Promise<boolean>;
}

/** Public APIs only. Connector currently exposes no atomic credential-generation commit guard. */
export function createConnectorClient(options: ConnectorClientOptions): ProviderGateway {
  if (!options.adminToken || !options.runtimeToken) {
    fail('connector_credentials_required');
  }
  const base = options.baseUrl.replace(/\/$/, '');
  async function request(input: RequestInput): Promise<JsonValue> {
    input.signal.throwIfAborted();
    const headers = new Headers({
      authorization: `Bearer ${input.admin ? options.adminToken : options.runtimeToken}`,
    });
    if (input.alias) {
      headers.set('x-oo-connector-alias', input.alias);
    }
    if (input.body) {
      headers.set('content-type', 'application/json');
    }
    const response = await options
      .fetch(
        new Request(`${base}${input.path}`, {
          method: input.body ? 'POST' : 'GET',
          headers,
          signal: input.signal,
          body: input.body ? JSON.stringify(input.body) : undefined,
        }),
      )
      .catch(() => {
        input.signal.throwIfAborted();
        throw connectorFailure({ ...input, kind: 'transport' });
      });
    return connectorData({ ...input, response });
  }
  return {
    async bind(input) {
      if (
        !(await options.authorizeConnection({
          actorId: input.actorId,
          ownerId: input.ownerId,
          connection: input.connection,
        }))
      ) {
        fail('not_found');
      }
      if (input.connection.service !== input.requirements.service) {
        fail('connection_mismatch');
      }
      const metadata = (await request({
        service: input.connection.service,
        operation: 'connection.read',
        path: `/v1/connections/by-id/${encodeURIComponent(input.connection.id)}`,
        admin: true,
        signal: input.signal,
      })) as JsonObject;
      checkConnection({ metadata, connection: input.connection, requirements: input.requirements });
      return operations({
        request,
        download: (file) => downloadFile({ ...options, ...file, signal: input.signal }),
        requirements: input.requirements,
        alias: metadata.alias as string,
        signal: input.signal,
      });
    },
  };
}
function checkConnection(input: {
  metadata: JsonObject;
  connection: ConnectionRef;
  requirements: ProviderRequirements;
}): void {
  const { metadata, connection, requirements } = input;
  if (
    metadata.id !== connection.id ||
    metadata.service !== requirements.service ||
    metadata.status !== 'active' ||
    typeof metadata.alias !== 'string' ||
    !metadata.alias
  ) {
    fail('connection_unavailable');
  }
}
function operations(input: {
  request(input: RequestInput): Promise<JsonValue>;
  download(input: {
    file: JsonValue;
    service: string;
    operation: string;
  }): Promise<ReadableStream<Uint8Array>>;
  requirements: ProviderRequirements;
  alias: string;
  signal: AbortSignal;
}): ProviderOperations {
  const { request, requirements, alias, signal } = input;
  const action: ProviderOperations['action'] = async (operation) => {
    if (!requirements.actions.includes(operation.id)) {
      fail('operation_denied');
    }
    const path = `/v1/actions/${encodeURIComponent(operation.id)}`;
    const diagnostics = { service: requirements.service, operation: operation.id };
    const metadata = (await request({ ...diagnostics, path, signal })) as JsonObject;
    if (metadata.service !== requirements.service) {
      fail('operation_denied');
    }
    return await request({
      ...diagnostics,
      path,
      body: { input: operation.input },
      alias,
      signal,
    });
  };
  return {
    action,
    async download(operation) {
      const file = await action(operation);
      return input.download({ file, service: requirements.service, operation: operation.id });
    },
    get(operation) {
      const { path } = operation;
      if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\\?#]/.test(path) ||
        !matchesProviderPath({ path, allowed: requirements.proxyPaths })
      ) {
        fail('operation_denied');
      }
      return request({
        service: requirements.service,
        operation: path,
        path: `/v1/proxy/${encodeURIComponent(requirements.service)}`,
        body: { endpoint: path, method: 'GET', query: operation.query ?? {} },
        alias,
        signal,
      }).then(providerResponse);
    },
    post(operation) {
      const { path } = operation;
      if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\\?#]/.test(path) ||
        !matchesProviderPath({ path, allowed: requirements.proxyPostPaths })
      ) {
        fail('operation_denied');
      }
      return request({
        service: requirements.service,
        operation: path,
        path: `/v1/proxy/${encodeURIComponent(requirements.service)}`,
        body: { endpoint: path, method: 'POST', body: operation.body },
        alias,
        signal,
      }).then(providerResponse);
    },
  };
}
