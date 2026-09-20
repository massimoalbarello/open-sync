import type { ProviderSetup as RuntimeProviderSetup } from '@context-use/open-sync';

export const authLabels: Record<RuntimeProviderSetup['auth'][number]['type'], string> = {
  oauth2: 'OAuth',
  api_key: 'API key',
  custom_credential: 'Credentials',
  no_auth: 'No authentication',
};
