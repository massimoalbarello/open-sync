import type {
  ProviderAuthorization,
  ProviderConnection,
  ProviderScope,
} from '../../models/providers';

export interface ProviderRepository {
  list(scope: ProviderScope): Promise<ProviderConnection[]>;
  connection(input: ProviderScope & { id: string }): Promise<ProviderConnection | null>;
  owns(input: ProviderScope & { connectorId: string }): Promise<boolean>;
  start(input: ProviderScope & ProviderAuthorization): Promise<void>;
  pending(input: ProviderScope & { id: string }): Promise<ProviderAuthorization | null>;
  add(input: ProviderScope & ProviderConnection): Promise<void>;
  complete(input: ProviderScope & ProviderConnection): Promise<void>;
}
