import type { ConnectionRef } from '../../models/definition';
import type { Resource, Scope } from '../../models/identity';
import type { JsonObject, JsonValue } from '../../models/json';
import type { CreateSync, Sync, SyncPoll } from '../../models/sync';

export interface CatalogRepository {
  createSync(
    input: Omit<CreateSync, 'destination'> & {
      destination: { type: string; config: JsonObject };
      initialCheckpoint: JsonValue;
    },
  ): Sync;
  sync(input: Resource): Sync;
  syncs(scope: Scope): Sync[];
  polls(input: Resource & { before?: number }): { polls: SyncPoll[]; nextCursor: number | null };
  connectSync(input: Resource & { connection: ConnectionRef }): Sync;
  setEnabled(input: Resource & { enabled: boolean }): Sync;
  runNow(input: Resource): void;
  resync(input: Resource & { checkpoint: JsonValue }): void;
  removeSync(input: Resource): void;
}
