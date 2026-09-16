import type { Database } from 'bun:sqlite';
import type { Destination } from '../models/delivery';
import { fail } from '../models/error';
import type { Resource } from '../models/identity';
import type { Installation } from '../models/installation';

export type Row = Record<string, string | number | null>;
export function readInstallation(input: { db: Database; scope: Resource }): Installation {
  const row = input.db
    .query<Row, [string, string]>('SELECT * FROM installations WHERE owner_id=? AND id=?')
    .get(input.scope.ownerId, input.scope.id);
  if (!row) {
    fail('not_found');
  }
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    sourceId: String(row.source_id),
    definition: {
      id: String(row.definition_id),
      version: String(row.definition_version),
      artifactId: String(row.artifact_id),
    },
    connection: row.connection === null ? undefined : JSON.parse(String(row.connection)),
    config: JSON.parse(String(row.config)),
    destinationId: String(row.destination_id),
    enabled: row.enabled === 1,
    bindingEpoch: Number(row.binding_epoch),
    checkpoint: JSON.parse(String(row.checkpoint)),
    checkpointRevision: Number(row.checkpoint_revision),
    intervalMs: Number(row.interval_ms),
    nextDueAt: Number(row.next_due_at),
    status: String(row.status),
  };
}
export function readDestination(input: { db: Database; scope: Resource }): Destination {
  const row = input.db
    .query<Row, [string, string]>('SELECT * FROM destinations WHERE owner_id=? AND id=?')
    .get(input.scope.ownerId, input.scope.id);
  if (!row) {
    fail('not_found');
  }
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    type: String(row.type),
    version: String(row.version),
    config: JSON.parse(String(row.config)),
  };
}
