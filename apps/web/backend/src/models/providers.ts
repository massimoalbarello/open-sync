export interface ProviderScope {
  actorId: string;
  ownerId: string;
}
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
