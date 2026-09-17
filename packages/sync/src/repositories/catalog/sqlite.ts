import type { Database } from 'bun:sqlite';
import type { SyncDefinition } from '../../models/definition';
import { fail } from '../../models/error';
import type { Resource, Scope } from '../../models/identity';
import type { CreateInstallation } from '../../models/installation';
import { canonicalJson, type JsonObject, type JsonValue } from '../../models/json';
import { defaultTiming } from '../../models/limits';
import { readDestination, readInstallation } from '../rows';
import type { CatalogRepository } from './contract';

export class SqliteCatalog implements CatalogRepository {
  constructor(private readonly db: Database) {}
  register(definition: SyncDefinition): void {
    const manifest = canonicalJson(definition).json;
    this.db
      .transaction(() => {
        const previous = this.db
          .query<{ manifest: string }, [string, string]>(
            'SELECT manifest FROM definitions WHERE id=? AND version=?',
          )
          .get(definition.id, definition.version);
        if (previous && previous.manifest !== manifest) {
          fail('definition_conflict');
        }
        this.db
          .query('INSERT OR IGNORE INTO definitions VALUES (?,?,?,?)')
          .run(definition.id, definition.version, definition.artifactId, manifest);
      })
      .immediate();
  }
  createDestination(input: Scope & { type: string; version: string; config: JsonObject }) {
    const id = `dest_${crypto.randomUUID()}`;
    this.db
      .query('INSERT INTO destinations VALUES (?,?,?,?,?)')
      .run(input.ownerId, id, input.type, input.version, canonicalJson(input.config).json);
    return readDestination({ db: this.db, scope: { ...input, id } });
  }
  destinations(scope: Scope) {
    return this.db
      .query<{ id: string }, [string]>(
        'SELECT id FROM destinations WHERE owner_id=? ORDER BY rowid',
      )
      .all(scope.ownerId)
      .map(({ id }) => readDestination({ db: this.db, scope: { ...scope, id } }));
  }
  createInstallation(input: CreateInstallation & { initialCheckpoint: JsonValue }) {
    const id = `sync_${crypto.randomUUID()}`;
    this.db
      .transaction(() => {
        readDestination({ db: this.db, scope: { ...input, id: input.destinationId } });
        this.db
          .query(`INSERT INTO installations (owner_id,id,source_id,definition_id,definition_version,artifact_id,connection,config,destination_id,enabled,checkpoint,interval_ms,next_due_at,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            input.ownerId,
            id,
            `source_${crypto.randomUUID()}`,
            input.definition.id,
            input.definition.version,
            input.definition.artifactId,
            input.connection ? canonicalJson(input.connection).json : null,
            canonicalJson(input.config).json,
            input.destinationId,
            Number(input.enabled ?? true),
            canonicalJson(input.initialCheckpoint).json,
            input.intervalMs ?? defaultTiming.leaseMs,
            Date.now(),
            input.enabled === false ? 'disabled' : 'ready',
          );
      })
      .immediate();
    return this.installation({ ...input, id });
  }
  installation(input: Resource) {
    return readInstallation({ db: this.db, scope: input });
  }
  installations(scope: Scope) {
    return this.db
      .query<{ id: string }, [string]>(
        'SELECT id FROM installations WHERE owner_id=? ORDER BY rowid',
      )
      .all(scope.ownerId)
      .map(({ id }) => this.installation({ ...scope, id }));
  }
  runs(input: Resource & { offset: number }) {
    this.installation(input);
    const limit = 50;
    const rows = this.db
      .query<
        {
          id: string;
          state: string;
          started_at: number;
          completed_at: number | null;
          pages: number;
          checkpoint_revision: number;
        },
        [string, string, number, number]
      >(
        'SELECT id,state,started_at,completed_at,pages,checkpoint_revision FROM runs WHERE owner_id=? AND installation_id=? ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?',
      )
      .all(input.ownerId, input.id, limit + 1, input.offset);
    return {
      runs: rows.slice(0, limit).map((row) => ({
        id: row.id,
        state: row.state,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        pages: row.pages,
        checkpointRevision: row.checkpoint_revision,
      })),
      hasMore: rows.length > limit,
      pageSize: limit,
    };
  }
  setEnabled(input: Resource & { enabled: boolean }) {
    return this.db
      .transaction(() => {
        this.installation(input);
        this.db
          .query(
            'UPDATE installations SET enabled=?,binding_epoch=binding_epoch+1,status=?,next_due_at=? WHERE owner_id=? AND id=?',
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
            "UPDATE runs SET state='cancelled',completed_at=? WHERE owner_id=? AND installation_id=? AND state='running'",
          )
          .run(Date.now(), input.ownerId, input.id);
        return this.installation(input);
      })
      .immediate();
  }
  queue(input: Resource & { checkpoint?: JsonValue }): void {
    this.db
      .transaction(() => {
        if (!this.installation(input).enabled) {
          fail('disabled');
        }
        if (
          this.db
            .query("SELECT 1 FROM runs WHERE owner_id=? AND installation_id=? AND state='running'")
            .get(input.ownerId, input.id)
        ) {
          fail('busy');
        }
        if (input.checkpoint !== undefined) {
          this.db
            .query(
              'UPDATE installations SET checkpoint=?,checkpoint_revision=checkpoint_revision+1 WHERE owner_id=? AND id=?',
            )
            .run(canonicalJson(input.checkpoint).json, input.ownerId, input.id);
        }
        this.db
          .query("UPDATE installations SET next_due_at=?,status='ready' WHERE owner_id=? AND id=?")
          .run(Date.now(), input.ownerId, input.id);
      })
      .immediate();
  }
}
