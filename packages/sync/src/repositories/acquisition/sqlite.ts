import type { Database } from 'bun:sqlite';
import { definitionKey, type SyncDefinition, type SyncStep } from '../../models/definition';
import type { DeliveredRecord } from '../../models/delivery';
import { fail } from '../../models/error';
import { canonicalJson } from '../../models/json';
import type { QueueLimits } from '../../models/limits';
import { preparePage } from '../../models/page';
import { hasQueueCapacity } from '../queue-usage';
import type { AcquisitionRepository, RunLease } from './contract';
import { assertRun, claimRun, finishRun } from './lease';
import { enqueue } from './outbox';
import { writeRecord } from './records';

export class SqliteAcquisition implements AcquisitionRepository {
  constructor(
    private readonly input: { db: Database; limits: QueueLimits; historyLimit: number },
  ) {}
  nextDue(): number | undefined {
    return (
      this.input.db
        .query<{ due: number | null }, []>(`
      SELECT MIN(COALESCE((SELECT expires_at FROM runs r WHERE r.owner_id=i.owner_id
      AND r.installation_id=i.id AND r.state='running'), i.next_due_at)) AS due
      FROM installations i WHERE enabled=1`)
        .get()?.due ?? undefined
    );
  }
  claim(leaseMs: number) {
    return claimRun({ ...this.input, leaseMs });
  }
  hasCapacity(lease?: RunLease) {
    return hasQueueCapacity({ ...this.input, installation: lease?.installation });
  }
  commit(input: { lease: RunLease; page: SyncStep; definition: SyncDefinition }): void {
    const { db, limits } = this.input;
    const page = preparePage({ ...input, limits });
    db.transaction(() => {
      const installation = assertRun({ db, lease: input.lease });
      if (definitionKey(input.definition) !== definitionKey(installation.definition)) {
        fail('definition_conflict');
      }
      const records: DeliveredRecord[] = [];
      for (const record of page.deliverable.records) {
        const changed = writeRecord({ db, installation, record });
        if (changed) {
          records.push(changed);
        }
      }
      enqueue({ db, installation, records, limits, assets: page.deliverable.assets });
      db.query(
        'UPDATE installations SET checkpoint=?,checkpoint_revision=checkpoint_revision+1 WHERE owner_id=? AND id=?',
      ).run(canonicalJson(page.checkpoint).json, installation.ownerId, installation.id);
      db.query(
        `UPDATE runs SET records_processed=records_processed+?,records_changed=records_changed+? WHERE owner_id=? AND id=?`,
      ).run(page.deliverable.records.length, records.length, input.lease.ownerId, input.lease.id);
      db.query(`UPDATE polls SET records_processed=records_processed+?,records_changed=records_changed+?
        WHERE owner_id=? AND id=(SELECT poll_id FROM runs WHERE owner_id=? AND id=?)`).run(
        page.deliverable.records.length,
        records.length,
        input.lease.ownerId,
        input.lease.ownerId,
        input.lease.id,
      );
      finishRun({
        db,
        lease: input.lease,
        state: page.complete ? 'succeeded' : 'yielded',
        delay: page.complete ? installation.intervalMs : 0,
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
