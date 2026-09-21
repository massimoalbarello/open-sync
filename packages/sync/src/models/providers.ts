import type { RuntimeProviderSetup } from '@oomol-lab/open-connector';
import type { Scope } from './identity';
export type ProviderSetup = Omit<RuntimeProviderSetup, 'oauthClient'> & {
  oauthClient?: NonNullable<RuntimeProviderSetup['oauthClient']> & {
    automaticRegistration?: boolean;
  };
};

/** Host-registered provider code. Open Sync persists the result through encrypted Connector storage. */
export type OAuthClientRegistration = (input: {
  redirectUri: string;
  scopes: readonly string[];
  signal: AbortSignal;
}) => Promise<{ clientId: string; clientSecret?: string }>;

export type ProviderScope = Scope;
export interface ProviderConnection {
  id: string;
  connectorId: string;
  service: string;
  account: string;
}
export interface ProviderAuthorization {
  id: string;
  requestId: string;
  service: string;
}

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
