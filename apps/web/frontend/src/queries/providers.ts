import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';

export const providerKeys = {
  owner: (userId: string) => ['providers', userId] as const,
  catalog: (userId: string) => [...providerKeys.owner(userId), 'catalog'] as const,
  setup: (input: { userId: string; service: string }) =>
    [...providerKeys.owner(input.userId), input.service] as const,
};
export function providerOptions(userId: string) {
  return queryOptions({
    queryKey: providerKeys.catalog(userId),
    queryFn: loadProviders,
  });
}
async function loadProviders() {
  const result = await api.api.providers.get();
  if (result.error) {
    throw new Error('Could not load providers.');
  }
  return result.data;
}
export type ProviderCatalogEntry = Awaited<ReturnType<typeof loadProviders>>[number];

export function providerSetupOptions(input: { userId: string; service: string }) {
  return queryOptions({
    queryKey: providerKeys.setup(input),
    queryFn: () => loadProvider(input.service),
  });
}
export async function loadProvider(service: string) {
  const result = await api.api.providers({ service }).get();
  if (result.error) {
    throw new Error('Could not load this provider.');
  }
  return result.data;
}

export async function configureOAuth(input: { service: string; values: Record<string, string> }) {
  const result = await api.api
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
}) {
  const result = await api.api
    .providers({ service: input.service })
    .connect.post({ authorizationOptionIds: input.authorizationOptionIds });
  if (result.error) {
    throw new Error('Could not start authorization. Check the OAuth app configuration.');
  }
  return result.data;
}
export async function saveCredentials(input: {
  service: string;
  authType: 'api_key' | 'custom_credential';
  values: Record<string, string>;
}) {
  const { service, ...body } = input;
  const result = await api.api.providers({ service }).credentials.post(body);
  if (result.error) {
    throw new Error('Could not connect. Check the credentials and try again.');
  }
  return result.data;
}
