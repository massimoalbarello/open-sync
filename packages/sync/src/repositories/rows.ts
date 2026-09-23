import type { Database } from 'bun:sqlite';
import { fail } from '../models/error';
import type { Resource } from '../models/identity';
import type { Sync } from '../models/sync';

export type Row = Record<string, string | number | null>;
export function readSync(input: { db: Database; scope: Resource }): Sync {
  const row = input.db
    .query<Row, [string, string]>('SELECT * FROM syncs WHERE owner_id=? AND id=?')
    .get(input.scope.ownerId, input.scope.id);
  if (!row) {
    fail('not_found');
  }
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    definition: String(row.definition_id),
    connection: row.connection === null ? undefined : JSON.parse(String(row.connection)),
    config: JSON.parse(String(row.config)),
    destination: {
      type: String(row.destination_type),
      config: JSON.parse(String(row.destination_config)),
    },
    enabled: row.enabled === 1,
    bindingEpoch: Number(row.binding_epoch),
    checkpoint: JSON.parse(String(row.checkpoint)),
    checkpointRevision: Number(row.checkpoint_revision),
    intervalMs: Number(row.interval_ms),
    nextDueAt: Number(row.next_due_at),
    status: String(row.status),
  };
}
