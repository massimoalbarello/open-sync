const stagedRetentionMs = 86_400_000;

import type { Database } from 'bun:sqlite';
import { type AssetMetadata, type AssetOutcome, assetKey } from '../../models/asset';
import type { Delivery } from '../../models/delivery';
import { fail } from '../../models/error';
import { canonicalJson } from '../../models/json';
import { normalizeSourceTimestamps } from '../../models/metadata';
import { identifier } from '../../models/validation';
import { assertRun } from '../acquisition/lease';
import { assertDelivery } from '../delivery/lease';
import { assetBytes } from './capacity';
import type { AssetRepository, CapturedAsset } from './contract';

interface AssetRow {
  metadata: string;
  file_id: string | null;
  size: number;
  sha256: string;
  attempt: number;
  state: string;
  error_code: string | null;
}
export class SqliteAssets implements AssetRepository {
  constructor(
    private readonly input: {
      db: Database;
      maxBytes: number;
      maxSyncBytes: number;
      maxDeliveryBytes: number;
      maxMaterializedBytes: number;
    },
  ) {}
  capture(input: Parameters<AssetRepository['capture']>[0]): CapturedAsset {
    const { db } = this.input;
    validateMetadata(input.asset);
    return db
      .transaction(() => {
        assertRun({ db, lease: input.lease });
        const key = [
          input.lease.ownerId,
          input.lease.installation.sourceId,
          input.asset.id,
          input.asset.version,
        ];
        const metadata = canonicalJson({
          ...input.asset,
          ...normalizeSourceTimestamps(input.asset),
        }).json;
        db.query(
          'INSERT OR IGNORE INTO assets(owner_id,source_id,id,version,metadata) VALUES (?,?,?,?,?)',
        ).run(...key, metadata);
        const row = db
          .query<AssetRow, string[]>(
            'SELECT * FROM assets WHERE owner_id=? AND source_id=? AND id=? AND version=?',
          )
          .get(...key)!;
        if (row.metadata !== metadata) {
          fail('asset_version_conflict');
        }
        if (row.state === 'ready' && !row.file_id) {
          const receipt = db
            .query<{ outcome: string | null }, string[]>(
              'SELECT outcome FROM asset_receipts WHERE owner_id=? AND destination_id=? AND source_id=? AND asset_id=? AND asset_version=?',
            )
            .get(
              input.lease.ownerId,
              input.lease.installation.destinationId,
              input.lease.installation.sourceId,
              input.asset.id,
              input.asset.version,
            );
          if (!receipt?.outcome) {
            row.state = 'pending';
            db.query(
              "UPDATE assets SET state='pending',attempt=0 WHERE owner_id=? AND source_id=? AND id=? AND version=?",
            ).run(...key);
            row.attempt = 0;
          }
        }
        if (row.state === 'pending') {
          db.query(
            'UPDATE assets SET attempt=attempt+1 WHERE owner_id=? AND source_id=? AND id=? AND version=?',
          ).run(...key);
          row.attempt++;
        }
        if (row.file_id) {
          db.query('UPDATE asset_files SET run_id=? WHERE id=?').run(input.lease.id, row.file_id);
          db.query(
            'UPDATE assets SET committed=0 WHERE owner_id=? AND source_id=? AND id=? AND version=?',
          ).run(...key);
        }
        return captured(row);
      })
      .immediate();
  }
  captured(input: Parameters<AssetRepository['captured']>[0]): void {
    const { db } = this.input;
    db.transaction(() => {
      assertRun({ db, lease: input.lease });
      const previous = db
        .query<{ sha256: string | null }, string[]>(
          'SELECT sha256 FROM assets WHERE owner_id=? AND source_id=? AND id=? AND version=?',
        )
        .get(
          input.lease.ownerId,
          input.lease.installation.sourceId,
          input.asset.id,
          input.asset.version,
        );
      if (previous?.sha256 && previous.sha256 !== input.file.sha256) {
        fail('asset_version_conflict');
      }
      if (
        !db
          .query(
            'SELECT 1 FROM asset_files WHERE id=? AND owner_id=? AND source_id=? AND run_id=? AND bytes=?',
          )
          .get(
            input.file.id,
            input.lease.ownerId,
            input.lease.installation.sourceId,
            input.lease.id,
            input.file.size,
          )
      ) {
        fail('asset_reservation_missing');
      }
      db.query(
        "UPDATE assets SET file_id=?,size=?,sha256=?,stored_at=?,committed=0,state='ready',error_code=NULL WHERE owner_id=? AND source_id=? AND id=? AND version=?",
      ).run(
        input.file.id,
        input.file.size,
        input.file.sha256,
        Date.now(),
        input.lease.ownerId,
        input.lease.installation.sourceId,
        input.asset.id,
        input.asset.version,
      );
    }).immediate();
  }
  captureFailed(input: Parameters<AssetRepository['captureFailed']>[0]): void {
    const { db } = this.input;
    db.transaction(() => {
      assertRun({ db, lease: input.lease });
      db.query(
        'UPDATE assets SET state=?,error_code=? WHERE owner_id=? AND source_id=? AND id=? AND version=?',
      ).run(
        input.terminal ? 'failed' : 'pending',
        input.code,
        input.lease.ownerId,
        input.lease.installation.sourceId,
        input.asset.id,
        input.asset.version,
      );
    }).immediate();
  }
  captureDeferred(input: Parameters<AssetRepository['captureDeferred']>[0]): void {
    const { db } = this.input;
    db.transaction(() => {
      assertRun({ db, lease: input.lease });
      db.query(
        "UPDATE assets SET attempt=MAX(0,attempt-1),error_code=? WHERE owner_id=? AND source_id=? AND id=? AND version=? AND state='pending'",
      ).run(
        input.code,
        input.lease.ownerId,
        input.lease.installation.sourceId,
        input.asset.id,
        input.asset.version,
      );
    }).immediate();
  }
  reserve(input: Parameters<AssetRepository['reserve']>[0]): void {
    const { db, maxBytes, maxSyncBytes } = this.input;
    db.transaction(() => {
      assertRun({ db, lease: input.lease });
      const previous = db
        .query<{ bytes: number; run_id: string; owner_id: string; source_id: string }, string[]>(
          'SELECT bytes,run_id,owner_id,source_id FROM asset_files WHERE id=?',
        )
        .get(input.id);
      if (
        previous &&
        (previous.run_id !== input.lease.id ||
          previous.owner_id !== input.lease.ownerId ||
          previous.source_id !== input.lease.installation.sourceId ||
          input.bytes < previous.bytes)
      ) {
        fail('asset_reservation_conflict');
      }
      const delta = input.bytes - (previous?.bytes ?? 0);
      if (
        delta + assetBytes({ db, ownerId: input.lease.ownerId, runId: input.lease.id }) >
        Math.min(maxBytes, maxSyncBytes)
      ) {
        fail('step_exceeds_asset_capacity');
      }
      if (
        delta + assetBytes({ db }) > maxBytes ||
        delta +
          assetBytes({
            db,
            ownerId: input.lease.ownerId,
            sourceId: input.lease.installation.sourceId,
          }) >
          maxSyncBytes
      ) {
        fail('waiting_for_capacity');
      }
      db.query(`INSERT INTO asset_files(id,owner_id,source_id,run_id,bytes) VALUES (?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes`).run(
        input.id,
        input.lease.ownerId,
        input.lease.installation.sourceId,
        input.lease.id,
        input.bytes,
      );
    }).immediate();
  }
  discarded(id: string): void {
    const deleted = this.input.db
      .query(
        'DELETE FROM asset_files WHERE id=? AND NOT EXISTS (SELECT 1 FROM assets WHERE file_id=?)',
      )
      .run(id, id);
    if (deleted.changes) {
      this.input.db
        .query(
          "UPDATE installations SET next_due_at=? WHERE enabled=1 AND status='waiting_for_capacity'",
        )
        .run(Date.now());
    }
  }

  garbage() {
    const { db } = this.input;
    return db
      .transaction(() => {
        if (
          db.query("SELECT 1 FROM runs WHERE state='running' AND expires_at>?").get(Date.now()) ||
          db.query("SELECT 1 FROM deliveries WHERE state='leased' AND expires_at>?").get(Date.now())
        ) {
          return;
        }
        const unused = db
          .query<
            { file_id: string },
            [number]
          >(`SELECT file_id FROM assets a WHERE file_id IS NOT NULL AND (a.committed=1 OR a.stored_at<? OR EXISTS (SELECT 1 FROM installations i WHERE i.owner_id=a.owner_id AND i.source_id=a.source_id AND i.status='succeeded')) AND NOT EXISTS (
        SELECT 1 FROM delivery_assets d WHERE d.owner_id=a.owner_id AND d.source_id=a.source_id AND d.asset_id=a.id AND d.asset_version=a.version)`)
          .all(Date.now() - stagedRetentionMs);
        for (const row of unused) {
          db.query('UPDATE assets SET file_id=NULL WHERE file_id=?').run(row.file_id);
        }
        const orphaned = db
          .query<
            { id: string },
            [number]
          >(`SELECT f.id FROM asset_files f WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.file_id=f.id)
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.owner_id=f.owner_id AND r.id=f.run_id AND r.state='running' AND r.expires_at>?)`)
          .all(Date.now());
        const retain = db
          .query<{ file_id: string }, []>('SELECT file_id FROM assets WHERE file_id IS NOT NULL')
          .all()
          .map((row) => row.file_id);
        return {
          remove: [
            ...new Set([...unused.map((row) => row.file_id), ...orphaned.map((row) => row.id)]),
          ],
          retain,
        };
      })
      .immediate();
  }
  read(input: Parameters<AssetRepository['read']>[0]): CapturedAsset {
    assertDelivery({ db: this.input.db, lease: input.lease });
    if (
      !input.lease.delivery.deliverable.assets?.some(
        (asset) => assetKey(asset) === assetKey(input.asset),
      )
    ) {
      fail('not_found');
    }
    const row = this.input.db
      .query<AssetRow, string[]>(
        'SELECT * FROM assets WHERE owner_id=? AND source_id=? AND id=? AND version=?',
      )
      .get(input.lease.ownerId, input.lease.delivery.sourceId, input.asset.id, input.asset.version);
    if (!row) {
      return fail('not_found');
    }
    return captured(row);
  }
  receipt(input: Parameters<AssetRepository['receipt']>[0]) {
    const { db } = this.input;
    return db
      .transaction(() => {
        this.read(input);
        const keys = receiptKeys(input);
        db.query(
          'INSERT OR IGNORE INTO asset_receipts(owner_id,destination_id,source_id,asset_id,asset_version,idempotency_key) VALUES (?,?,?,?,?,?)',
        ).run(...keys, `asset_${crypto.randomUUID()}`);
        const row = db
          .query<{ idempotency_key: string; attempt: number; outcome: string | null }, string[]>(
            'SELECT * FROM asset_receipts WHERE owner_id=? AND destination_id=? AND source_id=? AND asset_id=? AND asset_version=?',
          )
          .get(...keys)!;
        if (!row.outcome) {
          db.query(
            'UPDATE asset_receipts SET attempt=attempt+1 WHERE owner_id=? AND destination_id=? AND source_id=? AND asset_id=? AND asset_version=?',
          ).run(...keys);
          row.attempt++;
        }
        return {
          key: row.idempotency_key,
          attempt: row.attempt,
          outcome: row.outcome ? (JSON.parse(row.outcome) as AssetOutcome) : undefined,
        };
      })
      .immediate();
  }
  recordOutcome(input: Parameters<AssetRepository['recordOutcome']>[0]): void {
    const { db } = this.input;
    db.transaction(() => {
      this.read(input);
      db.query(
        'UPDATE asset_receipts SET outcome=? WHERE owner_id=? AND destination_id=? AND source_id=? AND asset_id=? AND asset_version=? AND outcome IS NULL',
      ).run(canonicalJson(input.outcome).json, ...receiptKeys(input));
    }).immediate();
  }
  materialize(input: Parameters<AssetRepository['materialize']>[0]): Delivery {
    const { db } = this.input;
    return db
      .transaction(() => {
        assertDelivery({ db, lease: input.lease });
        const row = db
          .query<{ materialized: string | null }, string[]>(
            'SELECT materialized FROM deliveries WHERE owner_id=? AND id=?',
          )
          .get(input.lease.ownerId, input.lease.delivery.id)!;
        if (row.materialized) {
          return JSON.parse(row.materialized) as Delivery;
        }
        const delivery = input.build();
        if (
          delivery.id !== input.lease.delivery.id ||
          delivery.ownerId !== input.lease.ownerId ||
          delivery.sourceId !== input.lease.delivery.sourceId
        ) {
          fail('invalid_materialized_delivery');
        }
        const body = canonicalJson(delivery).json;
        if (Buffer.byteLength(body) > this.input.maxDeliveryBytes) {
          fail('materialized_delivery_too_large');
        }
        const usage = db
          .query<{ bytes: number }, []>(
            'SELECT coalesce(sum(length(cast(materialized AS BLOB))),0) AS bytes FROM deliveries',
          )
          .get()!;
        if (usage.bytes + Buffer.byteLength(body) > this.input.maxMaterializedBytes) {
          fail('materialized_queue_full');
        }
        db.query('UPDATE deliveries SET materialized=? WHERE owner_id=? AND id=?').run(
          body,
          input.lease.ownerId,
          input.lease.delivery.id,
        );
        return JSON.parse(body) as Delivery;
      })
      .immediate();
  }
}
function receiptKeys(input: Parameters<AssetRepository['receipt']>[0]): string[] {
  return [
    input.lease.ownerId,
    input.lease.destination.id,
    input.lease.delivery.sourceId,
    input.asset.id,
    input.asset.version,
  ];
}
function captured(row: AssetRow): CapturedAsset {
  return {
    asset: {
      ...(JSON.parse(row.metadata) as AssetMetadata),
      ...(row.state === 'ready'
        ? { size: row.size, sha256: row.sha256 }
        : { unavailable: row.error_code ?? 'asset_pending' }),
    },
    fileId: row.file_id,
    attempt: row.attempt,
    state: row.state,
  };
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
