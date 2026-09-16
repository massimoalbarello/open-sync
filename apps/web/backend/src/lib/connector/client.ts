import type { RuntimeProviderSetup } from '@oomol-lab/open-connector';
import { BadRequestError } from '#backend/lib/errors.ts';

export interface ProviderCatalogEntry {
  service: string;
  displayName: string;
  iconUrl: string | null;
  categories: { id: string; displayName: string }[];
  scenario: string;
  authTypes: RuntimeProviderSetup['auth'][number]['type'][];
}

export interface ConnectorManagement {
  catalog(): Promise<ProviderCatalogEntry[]>;
  call(input: {
    path: string;
    method?: 'POST' | 'PUT';
    body?: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}
/** Only the host uses administrator credentials. No raw Connector routes are exposed to users. */
export function connectorManagement(input: {
  fetch(request: Request): Promise<Response>;
  baseUrl: string;
  adminToken: string;
  runtimeToken: string;
}): ConnectorManagement {
  const timeoutMs = 30_000;
  async function requestData({
    request,
    token,
  }: {
    request: { path: string; method?: 'POST' | 'PUT'; body?: Record<string, unknown> };
    token: string;
  }): Promise<unknown> {
    const response = await input.fetch(
      new Request(`${input.baseUrl}${request.path}`, {
        method: request.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    const result = (await response.json()) as Record<string, unknown>;
    // The documented OAuth configuration API returns a bare summary; /v1 uses an envelope.
    const versioned = request.path.startsWith('/v1/');
    const data = versioned ? result.data : result;
    if (
      !response.ok ||
      (versioned && result.success !== true) ||
      !data ||
      typeof data !== 'object'
    ) {
      // Do not echo provider errors or request bodies, which can contain credentials.
      throw new BadRequestError(
        'Open Connector could not complete this request. Check provider configuration and authorization.',
      );
    }
    return data;
  }
  return {
    async catalog() {
      const data = await requestData({
        request: { path: '/v1/providers' },
        token: input.runtimeToken,
      });
      if (!Array.isArray(data)) {
        throw new BadRequestError('Invalid provider catalog.');
      }
      return data as ProviderCatalogEntry[];
    },
    async call(request) {
      const data = await requestData({ request, token: input.adminToken });
      if (Array.isArray(data)) {
        throw new BadRequestError('Invalid provider response.');
      }
      return data as Record<string, unknown>;
    },
  };
}
