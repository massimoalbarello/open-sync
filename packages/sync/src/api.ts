import type { SyncManagement } from './services/management';
import type { ProviderService } from './services/providers/service';

/** Deliberate public selections: internal service methods are not automatically host APIs. */
export type SyncApi = Pick<
  SyncManagement,
  | 'definitions'
  | 'destinationTypes'
  | 'runs'
  | 'createSync'
  | 'connectSync'
  | 'syncs'
  | 'sync'
  | 'setEnabled'
  | 'runNow'
  | 'resync'
  | 'removeSync'
  | 'status'
  | 'deliveries'
  | 'retryDelivery'
>;
export type ProviderApi = Pick<
  ProviderService,
  'connections' | 'connection' | 'catalog' | 'status' | 'configure' | 'start' | 'credentials'
>;

export function syncApi(service: SyncManagement): SyncApi {
  return {
    definitions: service.definitions.bind(service),
    destinationTypes: service.destinationTypes.bind(service),
    runs: service.runs.bind(service),
    createSync: service.createSync.bind(service),
    connectSync: service.connectSync.bind(service),
    syncs: service.syncs.bind(service),
    sync: service.sync.bind(service),
    setEnabled: service.setEnabled.bind(service),
    runNow: service.runNow.bind(service),
    resync: service.resync.bind(service),
    removeSync: service.removeSync.bind(service),
    status: service.status.bind(service),
    deliveries: service.deliveries.bind(service),
    retryDelivery: service.retryDelivery.bind(service),
  };
}
export function providerApi(service: ProviderService): ProviderApi {
  return {
    connections: service.connections.bind(service),
    connection: service.connection.bind(service),
    catalog: service.catalog.bind(service),
    status: service.status.bind(service),
    configure: service.configure.bind(service),
    start: service.start.bind(service),
    credentials: service.credentials.bind(service),
  };
}
