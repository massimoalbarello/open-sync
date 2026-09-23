import type { Database } from 'bun:sqlite';
import type { ConnectionRef } from '../../models/definition';
import { fail } from '../../models/error';
import type { Resource, Scope } from '../../models/identity';
import { canonicalJson, type JsonObject, type JsonValue } from '../../models/json';
import type { CreateSync } from '../../models/sync';
import { readSync } from '../rows';
import type { CatalogRepository } from './contract';

const defaultIntervalMs = 60_000;

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
        input.intervalMs ?? defaultIntervalMs,
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
  connectSync(input: Resource & { connection: ConnectionRef }) {
    return this.db
      .transaction(() => {
        const sync = this.sync(input);
        if (sync.connection || sync.enabled) {
          fail('already_connected');
        }
        this.db
          .query(`UPDATE syncs SET connection=?,enabled=1,
        status='ready',error_code=NULL,next_due_at=? WHERE owner_id=? AND id=?`)
          .run(canonicalJson(input.connection).json, Date.now(), input.ownerId, input.id);
        return this.sync(input);
      })
      .immediate();
  }
  setEnabled(input: Resource & { enabled: boolean }) {
    return this.db
      .transaction(() => {
        const sync = this.sync(input);
        if (sync.enabled === input.enabled) {
          return sync;
        }
        this.db
          .query(
            `UPDATE syncs SET enabled=?,status=?,error_code=NULL,next_due_at=?,generation=generation+1,expires_at=NULL WHERE owner_id=? AND id=?`,
          )
          .run(
            Number(input.enabled),
            input.enabled ? 'ready' : 'disabled',
            Date.now(),
            input.ownerId,
            input.id,
          );
        return this.sync(input);
      })
      .immediate();
  }
  runNow(input: Resource): void {
    this.db
      .transaction(() => {
        if (!this.sync(input).enabled) {
          fail('disabled');
        }
        if (
          this.db
            .query(`SELECT 1 FROM syncs WHERE owner_id=? AND id=? AND expires_at>?`)
            .get(input.ownerId, input.id, Date.now())
        ) {
          fail('busy');
        }
        this.db
          .query(`UPDATE syncs SET next_due_at=? WHERE owner_id=? AND id=?`)
          .run(Date.now(), input.ownerId, input.id);
      })
      .immediate();
  }
  resync(input: Resource & { checkpoint: JsonValue }): void {
    this.db
      .transaction(() => {
        if (!this.sync(input).enabled) {
          fail('disabled');
        }
        this.db
          .query(
            `UPDATE syncs SET checkpoint=?,status='ready',error_code=NULL,next_due_at=?,resync=1,failure_count=0,generation=generation+1,expires_at=NULL WHERE owner_id=? AND id=?`,
          )
          .run(canonicalJson(input.checkpoint).json, Date.now(), input.ownerId, input.id);
      })
      .immediate();
  }
  removeSync(input: Resource): void {
    this.db
      .transaction(() => {
        this.sync(input);
        this.db
          .query('DELETE FROM deliveries WHERE owner_id=? AND sync_id=?')
          .run(input.ownerId, input.id);
        this.db
          .query('DELETE FROM record_state WHERE owner_id=? AND sync_id=?')
          .run(input.ownerId, input.id);
        this.db.query('DELETE FROM syncs WHERE owner_id=? AND id=?').run(input.ownerId, input.id);
        this.db
          .query(`UPDATE syncs SET next_due_at=? WHERE enabled=1 AND status='waiting_for_capacity'`)
          .run(Date.now());
      })
      .immediate();
  }
}
