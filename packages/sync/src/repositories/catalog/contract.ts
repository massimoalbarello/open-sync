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
  polls(input: Resource & { offset: number }): {
    polls: SyncPoll[];
    hasMore: boolean;
    pageSize: number;
  };
  connectSync(input: Resource & { connection: ConnectionRef }): Sync;
  setEnabled(input: Resource & { enabled: boolean }): Sync;
  queue(input: Resource & { checkpoint?: JsonValue }): void;
}
