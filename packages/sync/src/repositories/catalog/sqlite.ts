import type { Database } from 'bun:sqlite';
import type { ConnectionRef } from '../../models/definition';
import { fail } from '../../models/error';
import type { Resource, Scope } from '../../models/identity';
import { canonicalJson, type JsonObject, type JsonValue } from '../../models/json';
import { defaultTiming } from '../../models/limits';
import type { CreateSync } from '../../models/sync';
import { readSync } from '../rows';
import type { CatalogRepository } from './contract';
import { readPolls } from './history';

export class SqliteCatalog implements CatalogRepository {
  constructor(private readonly db: Database) {}
  createSync(
    input: Omit<CreateSync, 'destination'> & {
      destination: { type: string; config: JsonObject };
      initialCheckpoint: JsonValue;
    },
  ) {
    const id = `sync_${crypto.randomUUID()}`;
    this.db
      .query(`INSERT INTO syncs (owner_id,id,definition_id,connection,config,destination_type,destination_config,enabled,checkpoint,interval_ms,next_due_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        input.ownerId,
        id,
        input.definition,
        input.connection ? canonicalJson(input.connection).json : null,
        canonicalJson(input.config).json,
        input.destination.type,
        canonicalJson(input.destination.config).json,
        Number(input.enabled ?? true),
        canonicalJson(input.initialCheckpoint).json,
        input.intervalMs ?? defaultTiming.leaseMs,
        Date.now(),
        input.enabled === false ? 'disabled' : 'ready',
      );
    return this.sync({ ...input, id });
  }
  sync(input: Resource) {
    return readSync({ db: this.db, scope: input });
  }
  syncs(scope: Scope) {
    return this.db
      .query<{ id: string }, [string]>('SELECT id FROM syncs WHERE owner_id=? ORDER BY rowid')
      .all(scope.ownerId)
      .map(({ id }) => this.sync({ ...scope, id }));
  }
  polls(input: Resource & { offset: number }) {
    this.sync(input);
    return readPolls({ db: this.db, scope: input });
  }
  connectSync(input: Resource & { connection: ConnectionRef }) {
    return this.db
      .transaction(() => {
        const sync = this.sync(input);
        if (sync.connection || sync.enabled) {
          fail('already_connected');
        }
        this.db
          .query(`UPDATE syncs SET connection=?,enabled=1,
        binding_epoch=binding_epoch+1,status='ready',next_due_at=? WHERE owner_id=? AND id=?`)
          .run(canonicalJson(input.connection).json, Date.now(), input.ownerId, input.id);
        return this.sync(input);
      })
      .immediate();
  }
  setEnabled(input: Resource & { enabled: boolean }) {
    return this.db
      .transaction(() => {
        this.sync(input);
        this.db
          .query(
            'UPDATE syncs SET enabled=?,binding_epoch=binding_epoch+1,status=?,next_due_at=? WHERE owner_id=? AND id=?',
          )
          .run(
            Number(input.enabled),
            input.enabled ? 'ready' : 'disabled',
            Date.now(),
            input.ownerId,
            input.id,
          );
        this.db
          .query(
            "UPDATE runs SET state='paused',completed_at=? WHERE owner_id=? AND sync_id=? AND state='running'",
          )
          .run(Date.now(), input.ownerId, input.id);
        this.db
          .query('UPDATE polls SET state=? WHERE owner_id=? AND sync_id=? AND completed_at IS NULL')
          .run(input.enabled ? 'syncing' : 'paused', input.ownerId, input.id);
        return this.sync(input);
      })
      .immediate();
  }
  queue(input: Resource & { checkpoint?: JsonValue }): void {
    this.db
      .transaction(() => {
        if (!this.sync(input).enabled) {
          fail('disabled');
        }
        if (
          this.db
            .query("SELECT 1 FROM runs WHERE owner_id=? AND sync_id=? AND state='running'")
            .get(input.ownerId, input.id)
        ) {
          fail('busy');
        }
        if (input.checkpoint !== undefined) {
          this.db
            .query(
              "UPDATE polls SET state='cancelled',completed_at=? WHERE owner_id=? AND sync_id=? AND completed_at IS NULL",
            )
            .run(Date.now(), input.ownerId, input.id);
          this.db
            .query(
              'UPDATE syncs SET checkpoint=?,checkpoint_revision=checkpoint_revision+1 WHERE owner_id=? AND id=?',
            )
            .run(canonicalJson(input.checkpoint).json, input.ownerId, input.id);
        }
        this.db
          .query("UPDATE syncs SET next_due_at=?,status='ready' WHERE owner_id=? AND id=?")
          .run(Date.now(), input.ownerId, input.id);
      })
      .immediate();
  }
}
