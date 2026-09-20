import type { Database } from 'bun:sqlite';
import type {
  ProviderAuthorization,
  ProviderConnection,
  ProviderScope,
} from '../../models/providers';
import type { ProviderRepository } from './contract';

// This database contains only Open Sync's ownership references, never provider credentials.
export class SqliteProviders implements ProviderRepository {
  constructor(private readonly db: Database) {}
  list(scope: ProviderScope) {
    return Promise.resolve(
      this.db
        .query<ProviderConnection, [string]>(
          'SELECT id, connector_id AS connectorId, account, service FROM provider_connections WHERE owner_id=? ORDER BY id',
        )
        .all(scope.ownerId),
    );
  }
  connection(input: ProviderScope & { id: string }) {
    return Promise.resolve(
      this.db
        .query<ProviderConnection, [string, string]>(
          'SELECT id, connector_id AS connectorId, account, service FROM provider_connections WHERE owner_id=? AND id=?',
        )
        .get(input.ownerId, input.id),
    );
  }
  owns(input: ProviderScope & { connectorId: string }) {
    return Promise.resolve(
      Boolean(
        this.db
          .query('SELECT id FROM provider_connections WHERE owner_id=? AND connector_id=?')
          .get(input.ownerId, input.connectorId),
      ),
    );
  }
  start(input: ProviderScope & ProviderAuthorization) {
    this.db
      .query(`INSERT INTO provider_authorizations(owner_id,id,request_id,service) VALUES (?,?,?,?)
      ON CONFLICT(owner_id) DO UPDATE SET id=excluded.id,request_id=excluded.request_id,service=excluded.service`)
      .run(input.ownerId, input.id, input.requestId, input.service);
    return Promise.resolve();
  }
  pending(input: ProviderScope & { id: string }) {
    return Promise.resolve(
      this.db
        .query<ProviderAuthorization, [string, string]>(
          'SELECT id,request_id AS requestId,service FROM provider_authorizations WHERE owner_id=? AND id=?',
        )
        .get(input.ownerId, input.id),
    );
  }
  updateAccount(input: ProviderScope & ProviderConnection) {
    this.db
      .query(
        'UPDATE provider_connections SET account=? WHERE owner_id=? AND id=? AND connector_id=?',
      )
      .run(input.account, input.ownerId, input.id, input.connectorId);
    return Promise.resolve();
  }
  add(input: ProviderScope & ProviderConnection) {
    this.db
      .query(
        'INSERT INTO provider_connections(owner_id,id,connector_id,account,service) VALUES (?,?,?,?,?)',
      )
      .run(input.ownerId, input.id, input.connectorId, input.account, input.service);
    return Promise.resolve();
  }
  complete(input: ProviderScope & ProviderConnection & { requestId: string }) {
    this.db
      .transaction(() => {
        // A superseded authorization must never claim a connection.
        this.db
          .query(`INSERT INTO provider_connections(owner_id,id,connector_id,account,service)
        SELECT owner_id,id,?,?,? FROM provider_authorizations WHERE owner_id=? AND id=? AND request_id=?
        ON CONFLICT(owner_id,id) DO UPDATE SET account=excluded.account
        WHERE provider_connections.connector_id=excluded.connector_id`)
          .run(
            input.connectorId,
            input.account,
            input.service,
            input.ownerId,
            input.id,
            input.requestId,
          );
        this.db
          .query('DELETE FROM provider_authorizations WHERE owner_id=? AND id=? AND request_id=?')
          .run(input.ownerId, input.id, input.requestId);
      })
      .immediate();
    return Promise.resolve();
  }
}
