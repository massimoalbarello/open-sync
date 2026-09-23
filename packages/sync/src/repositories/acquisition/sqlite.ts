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
import type { AcquisitionRepository, RunLease } from './contract';
import { assertRun, claimRun, finishRun } from './lease';
import { enqueue } from './outbox';
import { writeRecord } from './records';

export class SqliteAcquisition implements AcquisitionRepository {
  constructor(
    private readonly input: { db: Database; limits: QueueLimits; historyLimit: number },
  ) {}
  capacityReleased(): void {
    this.input.db
      .query("UPDATE syncs SET next_due_at=? WHERE enabled=1 AND status='waiting_for_capacity'")
      .run(Date.now());
  }
  nextDue(): number | undefined {
    return (
      this.input.db
        .query<{ due: number | null }, []>(`
      SELECT MIN(COALESCE((SELECT expires_at FROM runs r WHERE r.owner_id=i.owner_id
      AND r.sync_id=i.id AND r.state='running'), i.next_due_at)) AS due
      FROM syncs i WHERE enabled=1`)
        .get()?.due ?? undefined
    );
  }
  claim(leaseMs: number) {
    return claimRun({ ...this.input, leaseMs });
  }
  hasCapacity(lease?: RunLease) {
    return hasQueueCapacity({ ...this.input, sync: lease?.sync });
  }
  commit(input: { lease: RunLease; page: SyncStep; definition: SyncDefinition }): void {
    const { db, limits } = this.input;
    const page = preparePage({ ...input, limits });
    db.transaction(() => {
      const sync = assertRun({ db, lease: input.lease });
      if (input.definition.id !== sync.definition) {
        fail('definition_conflict');
      }
      const { records, assets } = changedRecords({ db, lease: input.lease, sync, page });
      enqueue({ db, sync, records, limits, assets, lease: input.lease });
      db.query(
        'UPDATE syncs SET checkpoint=?,checkpoint_revision=checkpoint_revision+1 WHERE owner_id=? AND id=?',
      ).run(canonicalJson(page.checkpoint).json, sync.ownerId, sync.id);
      db.query(
        `UPDATE runs SET records_processed=records_processed+?,records_changed=records_changed+? WHERE owner_id=? AND id=?`,
      ).run(page.records.length, records.length, input.lease.ownerId, input.lease.id);
      db.query(`UPDATE polls SET records_processed=records_processed+?,records_changed=records_changed+?
        WHERE owner_id=? AND id=(SELECT poll_id FROM runs WHERE owner_id=? AND id=?)`).run(
        page.records.length,
        records.length,
        input.lease.ownerId,
        input.lease.ownerId,
        input.lease.id,
      );
      finishRun({
        db,
        lease: input.lease,
        state: page.complete ? 'succeeded' : 'yielded',
        delay: page.complete ? sync.intervalMs : 0,
        failureCount: page.complete ? 0 : undefined,
      });
    }).immediate();
    input.lease.checkpointRevision++;
  }
  finish(input: {
    lease: RunLease;
    state: string;
    delay: number;
    failureCount?: number;
    pause?: boolean;
  }): void {
    this.input.db
      .transaction(() => {
        assertRun({ db: this.input.db, lease: input.lease });
        finishRun({ db: this.input.db, ...input });
      })
      .immediate();
  }
}

function changedRecords(input: {
  db: Database;
  lease: RunLease;
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
    const changed = writeRecord({ db: input.db, sync: input.sync, record, assets: referenced });
    if (changed) {
      records.push(changed);
      for (const asset of referenced) {
        assets.set(assetKey(asset), asset);
      }
    }
  }
  return { records, assets: [...assets.values()] };
}
