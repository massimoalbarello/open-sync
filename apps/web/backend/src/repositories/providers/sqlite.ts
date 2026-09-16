import type { SQL } from 'bun';
import type {
  ProviderAuthorization,
  ProviderConnection,
  ProviderScope,
} from '#backend/models/providers.ts';
import type { ProviderRepository } from './contract';

interface ConnectionRow {
  id: string;
  connector_id: string;
  account: string;
  service: string;
}

export class SqliteProviders implements ProviderRepository {
  constructor(private readonly db: SQL) {}
  async list(scope: ProviderScope): Promise<ProviderConnection[]> {
    const rows = await this.db<
      ConnectionRow[]
    >`SELECT id,connector_id,account,service FROM provider_connections WHERE owner_id=${scope.ownerId} ORDER BY id`;
    return rows.map((row) => ({
      id: row.id,
      connectorId: row.connector_id,
      account: row.account,
      service: row.service,
    }));
  }
  async connection(input: ProviderScope & { id: string }): Promise<ProviderConnection | null> {
    const [row] = await this
      .db`SELECT id,connector_id,account,service FROM provider_connections WHERE owner_id=${input.ownerId} AND id=${input.id}`;
    return row
      ? { id: row.id, connectorId: row.connector_id, account: row.account, service: row.service }
      : null;
  }
  async owns(input: ProviderScope & { connectorId: string }): Promise<boolean> {
    const [row] = await this
      .db`SELECT id FROM provider_connections WHERE owner_id=${input.ownerId} AND connector_id=${input.connectorId}`;
    return Boolean(row);
  }
  async start(input: ProviderScope & ProviderAuthorization): Promise<void> {
    await this
      .db`INSERT INTO provider_authorizations(owner_id,id,request_id,service) VALUES (${input.ownerId},${input.id},${input.requestId},${input.service})
      ON CONFLICT(owner_id) DO UPDATE SET id=excluded.id,request_id=excluded.request_id,service=excluded.service`;
  }
  async pending(input: ProviderScope & { id: string }): Promise<ProviderAuthorization | null> {
    const [row] = await this
      .db`SELECT id,request_id,service FROM provider_authorizations WHERE owner_id=${input.ownerId} AND id=${input.id}`;
    return row ? { id: row.id, requestId: row.request_id, service: row.service } : null;
  }
  async add(input: ProviderScope & ProviderConnection): Promise<void> {
    await this.db`INSERT INTO provider_connections(owner_id,id,connector_id,account,service)
      VALUES (${input.ownerId},${input.id},${input.connectorId},${input.account},${input.service})`;
  }
  async complete(input: ProviderScope & ProviderConnection): Promise<void> {
    await this.db.begin(async (tx) => {
      // A superseded attempt cannot claim a connection, even if its OAuth callback arrives late.
      await tx`INSERT INTO provider_connections(owner_id,id,connector_id,account,service)
        SELECT owner_id,id,${input.connectorId},${input.account},${input.service} FROM provider_authorizations
        WHERE owner_id=${input.ownerId} AND id=${input.id} ON CONFLICT(owner_id,id) DO NOTHING`;
      await tx`DELETE FROM provider_authorizations WHERE owner_id=${input.ownerId} AND id=${input.id}`;
    });
  }
}
