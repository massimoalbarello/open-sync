import type { Database } from 'bun:sqlite';
import { assetKey, type DeliveryAsset } from '../../models/asset';
import type { SyncDefinition, SyncStep } from '../../models/definition';
import type { DeliveredRecord } from '../../models/delivery';
import { fail } from '../../models/error';
import { canonicalJson } from '../../models/json';
import type { QueueLimits } from '../../models/limits';
import { preparePage } from '../../models/page';
import { capturedAssets } from '../assets/sqlite';
import { hasQueueCapacity } from '../queue-usage';
import type { AcquisitionLease, AcquisitionRepository } from './contract';
import { assertAcquisition, claimAcquisition, finishAcquisition } from './lease';
import { enqueue } from './outbox';
import { writeRecord } from './records';

export class SqliteAcquisition implements AcquisitionRepository {
  constructor(private readonly input: { db: Database; limits: QueueLimits }) {}
  capacityReleased(): void {
    this.input.db
      .query("UPDATE syncs SET next_due_at=? WHERE enabled=1 AND status='waiting_for_capacity'")
      .run(Date.now());
  }
  nextDue(): number | undefined {
    return (
      this.input.db
        .query<{ due: number | null }, []>(`
      SELECT MIN(COALESCE(expires_at,next_due_at)) AS due FROM syncs WHERE enabled=1`)
        .get()?.due ?? undefined
    );
  }
  claim(leaseMs: number) {
    return claimAcquisition({ ...this.input, leaseMs });
  }
  hasCapacity() {
    return hasQueueCapacity(this.input);
  }
  commit(input: { lease: AcquisitionLease; page: SyncStep; definition: SyncDefinition }): void {
    const { db, limits } = this.input;
    const page = preparePage({ ...input, limits });
    db.transaction(() => {
      const sync = assertAcquisition({ db, lease: input.lease });
      if (input.definition.id !== sync.definition) {
        fail('definition_conflict');
      }
      const { records, assets } = changedRecords({ db, lease: input.lease, sync, page });
      enqueue({ db, sync, records, limits, assets, lease: input.lease });
      db.query(`UPDATE sync_polls SET records_processed=records_processed+?,records_queued=records_queued+?
        WHERE owner_id=? AND sync_id=? AND completed_at IS NULL`).run(
        page.records.length,
        records.length,
        sync.ownerId,
        sync.id,
      );
      db.query('UPDATE syncs SET checkpoint=? WHERE owner_id=? AND id=?').run(
        canonicalJson(page.checkpoint).json,
        sync.ownerId,
        sync.id,
      );
      finishAcquisition({
        db,
        lease: input.lease,
        state: page.complete ? 'succeeded' : 'ready',
        delay: page.complete ? sync.intervalMs : 0,
        failureCount: page.complete ? 0 : undefined,
      });
    }).immediate();
  }
  finish(input: Parameters<AcquisitionRepository['finish']>[0]): void {
    this.input.db
      .transaction(() => {
        assertAcquisition({ db: this.input.db, lease: input.lease });
        finishAcquisition({ db: this.input.db, ...input });
      })
      .immediate();
  }
}

function changedRecords(input: {
  db: Database;
  lease: AcquisitionLease;
  sync: import('../../models/sync').Sync;
  page: SyncStep;
}) {
  const records: DeliveredRecord[] = [];
  const assets = new Map<string, DeliveryAsset>();
  for (const record of input.page.records) {
    const referenced = capturedAssets({
      db: input.db,
      lease: input.lease,
      refs: record.operation === 'upsert' ? Object.values(record.assetRefs ?? {}) : [],
    });
    const changed = writeRecord({
      db: input.db,
      sync: input.sync,
      record,
      assets: referenced,
      force: input.lease.force,
    });
    if (changed) {
      records.push(changed);
      for (const asset of referenced) {
        assets.set(assetKey(asset), asset);
      }
    }
  }
  return { records, assets: [...assets.values()] };
}
