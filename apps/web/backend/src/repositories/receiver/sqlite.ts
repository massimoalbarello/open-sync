import type { DeliveredRecord, Delivery } from '@context-use/open-sync/delivery';
import { canonicalJson } from '@context-use/open-sync/json';
import type { SQL, TransactionSQL } from 'bun';
import type { ReceiverRepository, ReceiverScope } from './contract';

export class SqliteReceiver implements ReceiverRepository {
  constructor(private readonly db: SQL) {}
  async records(input: ReceiverScope & { sourceId?: string; offset: number }) {
    const limit = 50;
    const sourceId = input.sourceId ?? null;
    const rows = await this.db<
      { source_id: string; kind: string; record_id: string; revision: number; data: string }[]
    >`SELECT source_id,kind,record_id,revision,data FROM host_records
      WHERE owner_id=${input.ownerId} AND deleted=0 AND (${sourceId} IS NULL OR source_id=${sourceId})
      ORDER BY source_id,kind,record_id LIMIT ${limit + 1} OFFSET ${input.offset}`;
    return {
      records: rows.slice(0, limit).map((row) => ({
        sourceId: String(row.source_id),
        kind: String(row.kind),
        id: String(row.record_id),
        revision: Number(row.revision),
        data: JSON.parse(String(row.data)) as import('@context-use/open-sync/json').JsonObject,
      })),
      hasMore: rows.length > limit,
      pageSize: limit,
    };
  }
  async status(scope: ReceiverScope) {
    const [status] = await this.db`SELECT
      coalesce((SELECT paused FROM host_settings WHERE owner_id=${scope.ownerId}),0) AS paused,
      (SELECT count(*) FROM host_records WHERE owner_id=${scope.ownerId} AND deleted=0) AS records,
      (SELECT count(*) FROM host_receipts WHERE owner_id=${scope.ownerId}) AS receipts`;
    return {
      paused: Boolean(status.paused),
      records: Number(status.records),
      receipts: Number(status.receipts),
    };
  }
  async setPaused(input: ReceiverScope & { paused: boolean }): Promise<void> {
    await this
      .db`INSERT INTO host_settings(owner_id,paused) VALUES (${input.ownerId},${Number(input.paused)})
      ON CONFLICT(owner_id) DO UPDATE SET paused=excluded.paused`;
  }
  async accept(input: ReceiverScope & { delivery: Delivery }): Promise<boolean> {
    if (input.ownerId !== input.delivery.ownerId) {
      throw new Error('Receiver owner mismatch');
    }
    const bodyHash = canonicalJson(input.delivery).sha256;
    return await this.db.begin(async (tx) => {
      const [settings] = await tx`SELECT paused FROM host_settings WHERE owner_id=${input.ownerId}`;
      if (settings?.paused) {
        return false;
      }
      const [receipt] =
        await tx`SELECT body_hash FROM host_receipts WHERE owner_id=${input.ownerId} AND delivery_id=${input.delivery.id}`;
      if (receipt) {
        if (receipt.body_hash !== bodyHash) {
          throw new Error('Delivery identity reused with different content');
        }
        return true;
      }
      for (const record of input.delivery.deliverable.records) {
        await applyRecord({
          tx,
          ownerId: input.ownerId,
          sourceId: input.delivery.sourceId,
          record,
        });
      }
      await tx`INSERT INTO host_receipts VALUES (${input.ownerId},${input.delivery.id},${bodyHash})`;
      return true;
    });
  }
}
async function applyRecord(input: {
  tx: TransactionSQL;
  ownerId: string;
  sourceId: string;
  record: DeliveredRecord;
}): Promise<void> {
  const { tx, ownerId, sourceId, record } = input;
  const data = record.operation === 'upsert' ? canonicalJson(record.data).json : null;
  await tx`INSERT INTO host_records VALUES (${ownerId},${sourceId},${record.kind},${record.id},${record.revision},${Number(record.operation === 'delete')},${data})
    ON CONFLICT(owner_id,source_id,kind,record_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,data=excluded.data
    WHERE excluded.revision>host_records.revision`;
}
