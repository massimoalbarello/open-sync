import type { RuntimeProviderSetup } from '@oomol-lab/open-connector';
export type ProviderSetup = RuntimeProviderSetup;

import type { Scope } from './identity';
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
