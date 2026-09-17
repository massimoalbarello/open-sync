import type { ProviderSetup as RuntimeProviderSetup } from '@open-sync/core';

export const authLabels: Record<RuntimeProviderSetup['auth'][number]['type'], string> = {
  oauth2: 'OAuth',
  api_key: 'API key',
  custom_credential: 'Credentials',
  no_auth: 'No authentication',
};
