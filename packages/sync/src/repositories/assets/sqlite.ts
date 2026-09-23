import type { Database } from 'bun:sqlite';
import type { AssetMetadata, AssetRef, DeliveryAsset } from '../../models/asset';
import { assetKey } from '../../models/asset';
import { fail } from '../../models/error';
import { canonicalJson } from '../../models/json';
import { normalizeSourceTimestamps } from '../../models/metadata';
import { identifier } from '../../models/validation';
import type { RunLease } from '../acquisition/contract';
import { assertRun } from '../acquisition/lease';
import { assertDelivery } from '../delivery/lease';
import { assetBytes } from './capacity';
import type { AssetRepository } from './contract';

const retained = `EXISTS (SELECT 1 FROM deliveries d WHERE d.owner_id=a.owner_id AND d.id=a.delivery_id)
  OR EXISTS (SELECT 1 FROM sync_runs r WHERE r.owner_id=a.owner_id AND r.id=a.run_id
    AND r.generation=a.generation AND r.state='running' AND r.expires_at>?)`;

export class SqliteAssets implements AssetRepository {
  constructor(private readonly input: { db: Database; maxBytes: number; maxSyncBytes: number }) {}
  stage(input: Parameters<AssetRepository['stage']>[0]): string {
    const { db } = this.input;
    validateMetadata(input.asset);
    if (input.unavailable !== undefined) {
      identifier(input.unavailable);
    }
    return db
      .transaction(() => {
        assertRun({ db, lease: input.lease });
        const id = crypto.randomUUID();
        const descriptor = canonicalJson({
          ...input.asset,
          ...normalizeSourceTimestamps(input.asset),
          ...(input.unavailable === undefined ? {} : { unavailable: input.unavailable }),
        }).json;
        db.query(`INSERT INTO delivery_assets(id,owner_id,sync_id,run_id,generation,asset_id,asset_version,descriptor,ready)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          id,
          input.lease.ownerId,
          input.lease.sync.id,
          input.lease.id,
          input.lease.generation,
          input.asset.id,
          input.asset.version,
          descriptor,
          Number(input.unavailable !== undefined),
        );
        return id;
      })
      .immediate();
  }
  captured(input: Parameters<AssetRepository['captured']>[0]): void {
    const { db } = this.input;
    db.transaction(() => {
      assertRun({ db, lease: input.lease });
      const row = db
        .query<{ descriptor: string }, (string | number)[]>(
          'SELECT descriptor FROM delivery_assets WHERE id=? AND owner_id=? AND run_id=? AND generation=? AND bytes=? AND ready=0',
        )
        .get(input.id, input.lease.ownerId, input.lease.id, input.lease.generation, input.size);
      if (!row) {
        fail('asset_reservation_missing');
      }
      db.query('UPDATE delivery_assets SET descriptor=?,ready=1 WHERE id=?').run(
        canonicalJson({ ...JSON.parse(row!.descriptor), size: input.size, sha256: input.sha256 })
          .json,
        input.id,
      );
    }).immediate();
  }
  reserve(input: Parameters<AssetRepository['reserve']>[0]): void {
    const { db, maxBytes, maxSyncBytes } = this.input;
    db.transaction(() => {
      assertRun({ db, lease: input.lease });
      const row = db
        .query<{ bytes: number }, (string | number)[]>(
          'SELECT bytes FROM delivery_assets WHERE id=? AND owner_id=? AND run_id=? AND generation=? AND ready=0',
        )
        .get(input.id, input.lease.ownerId, input.lease.id, input.lease.generation);
      if (!row || input.bytes < row.bytes) {
        fail('asset_reservation_conflict');
      }
      const delta = input.bytes - row!.bytes;
      if (
        delta +
          assetBytes({
            db,
            ownerId: input.lease.ownerId,
            runId: input.lease.id,
            generation: input.lease.generation,
          }) >
        Math.min(maxBytes, maxSyncBytes)
      ) {
        fail('step_exceeds_asset_capacity');
      }
      if (
        delta + assetBytes({ db }) > maxBytes ||
        delta + assetBytes({ db, ownerId: input.lease.ownerId, syncId: input.lease.sync.id }) >
          maxSyncBytes
      ) {
        fail('waiting_for_capacity');
      }
      db.query('UPDATE delivery_assets SET bytes=? WHERE id=?').run(input.bytes, input.id);
    }).immediate();
  }
  discarded(id: string): void {
    const deleted = this.input.db
      .query<{ owner_id: string; sync_id: string }, [string, number]>(
        `DELETE FROM delivery_assets AS a WHERE id=? AND NOT (${retained}) RETURNING owner_id,sync_id`,
      )
      .get(id, Date.now());
    if (deleted) {
      this.input.db
        .query(
          "UPDATE syncs SET next_due_at=? WHERE enabled=1 AND status='waiting_for_capacity' AND NOT (owner_id=? AND id=?)",
        )
        .run(Date.now(), deleted.owner_id, deleted.sync_id);
    }
  }
  garbage(): string[] {
    return this.input.db
      .query<{ id: string }, [number]>(`SELECT a.id FROM delivery_assets a WHERE NOT (${retained})`)
      .all(Date.now())
      .map(({ id }) => id);
  }
  retained(id: string): boolean {
    // Any ledger row is retained by the filesystem sweep. Garbage cleanup owns its deletion.
    return !!this.input.db.query('SELECT 1 FROM delivery_assets WHERE id=?').get(id);
  }
  read(input: Parameters<AssetRepository['read']>[0]): string {
    assertDelivery({ db: this.input.db, lease: input.lease });
    const row = this.input.db
      .query<{ id: string; descriptor: string }, string[]>(
        'SELECT id,descriptor FROM delivery_assets WHERE owner_id=? AND delivery_id=? AND asset_id=? AND asset_version=? AND ready=1',
      )
      .get(input.lease.ownerId, input.lease.delivery.id, input.asset.id, input.asset.version);
    if (!row) {
      return fail('not_found');
    }
    if ('unavailable' in JSON.parse(row.descriptor)) {
      fail('asset_content_missing');
    }
    return row.id;
  }
}

/** Called inside the checkpoint transaction. A previous acquisition generation cannot supply bytes. */
export function capturedAssets(input: {
  db: Database;
  lease: RunLease;
  refs: readonly AssetRef[];
}): DeliveryAsset[] {
  const refs = new Map(input.refs.map((ref) => [assetKey(ref), ref]));
  return [...refs.keys()].sort().map((key) => {
    const ref = refs.get(key)!;
    const row = input.db
      .query<{ descriptor: string }, (string | number)[]>(
        'SELECT descriptor FROM delivery_assets WHERE owner_id=? AND run_id=? AND generation=? AND asset_id=? AND asset_version=? AND ready=1',
      )
      .get(input.lease.ownerId, input.lease.id, input.lease.generation, ref.id, ref.version);
    if (!row) {
      return fail('asset_not_captured');
    }
    return JSON.parse(row.descriptor) as DeliveryAsset;
  });
}
function validateMetadata(asset: AssetMetadata) {
  identifier(asset.id);
  identifier(asset.version);
  const maxName = 1024;
  const maxType = 256;
  if (
    typeof asset.name !== 'string' ||
    asset.name.length > maxName ||
    !asset.name ||
    typeof asset.mediaType !== 'string' ||
    !asset.mediaType ||
    asset.mediaType.length > maxType ||
    /[\r\n]/.test(asset.mediaType)
  ) {
    fail('invalid_asset_metadata');
  }
}
