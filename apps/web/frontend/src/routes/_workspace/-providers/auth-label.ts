import type { RuntimeProviderSetup } from '@oomol-lab/open-connector';

export const authLabels: Record<RuntimeProviderSetup['auth'][number]['type'], string> = {
  oauth2: 'OAuth',
  api_key: 'API key',
  custom_credential: 'Credentials',
  no_auth: 'No authentication',
};
