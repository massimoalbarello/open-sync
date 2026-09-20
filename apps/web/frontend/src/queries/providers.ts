import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { syncApi } from '../lib/api';

export const providerKeys = {
  owner: (userId: string) => ['providers', userId] as const,
  catalog: (userId: string) => [...providerKeys.owner(userId), 'catalog'] as const,
  setup: (input: { userId: string; service: string }) =>
    [...providerKeys.owner(input.userId), input.service] as const,
};
export function providerOptions(input: { userId: string; q: string }) {
  return infiniteQueryOptions({
    queryKey: [...providerKeys.catalog(input.userId), input.q],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const result = await syncApi.providers.catalog.get({
        query: { q: input.q, offset: pageParam },
        fetch: { signal },
      });
      if (result.error) {
        throw new Error('Could not load providers.');
      }
      return result.data;
    },
    // biome-ignore lint/complexity/useMaxParams: TanStack Query passes the page, pages and page parameter.
    getNextPageParam: (last, _pages, offset) => (last.hasMore ? offset + last.pageSize : undefined),
  });
}

export function providerSetupOptions(input: { userId: string; service: string }) {
  return queryOptions({
    queryKey: providerKeys.setup(input),
    queryFn: () => loadProvider(input.service),
  });
}
export async function loadProvider(service: string) {
  const result = await syncApi.providers({ service }).get();
  if (result.error) {
    throw new Error('Could not load this provider.');
  }
  return result.data;
}

export async function configureOAuth(input: { service: string; values: Record<string, string> }) {
  const result = await syncApi
    .providers({ service: input.service })
    ['oauth-client'].put({ values: input.values });
  if (result.error) {
    throw new Error('Could not save the OAuth app. Check the required credentials.');
  }
  return result.data;
}
export async function connectProvider(input: {
  service: string;
  authorizationOptionIds?: string[];
  connectionId?: string;
}) {
  const result = await syncApi.providers({ service: input.service }).connect.post({
    authorizationOptionIds: input.authorizationOptionIds,
    connectionId: input.connectionId,
  });
  if (result.error) {
    throw new Error('Could not start authorization. Check the OAuth app configuration.');
  }
  return result.data;
}
export async function saveCredentials(input: {
  service: string;
  authType: 'api_key' | 'custom_credential';
  connectionId?: string;
  values: Record<string, string>;
}) {
  const { service, ...body } = input;
  const result = await syncApi.providers({ service }).credentials.post(body);
  if (result.error) {
    throw new Error('Could not connect. Check the credentials and try again.');
  }
  return result.data;
}
