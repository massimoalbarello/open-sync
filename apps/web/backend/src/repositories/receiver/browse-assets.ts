import type { SQL } from 'bun';
import { referencedAssetIds } from '#backend/models/receiver/asset-references.ts';
import type { ReceivedAsset, ReceivedRecord, ReceiverScope } from './contract';

interface AssetRow {
  id: string;
  source_id: string;
  name: string;
  media_type: string;
  size: number;
}
function asset(row: AssetRow): ReceivedAsset {
  return {
    id: row.id,
    sourceId: row.source_id,
    name: row.name,
    mediaType: row.media_type,
    size: row.size,
  };
}
export async function browseAssets(
  input: ReceiverScope & { db: SQL; sourceId?: string; offset: number },
) {
  const pageSize = 50;
  const sourceId = input.sourceId ?? null;
  const rows = await input.db<AssetRow[]>`SELECT id,source_id,name,media_type,size FROM host_assets
    WHERE owner_id=${input.ownerId} AND (${sourceId} IS NULL OR source_id=${sourceId})
    ORDER BY source_id,name,id LIMIT ${pageSize + 1} OFFSET ${input.offset}`;
  return { assets: rows.slice(0, pageSize).map(asset), hasMore: rows.length > pageSize, pageSize };
}
export async function relateAssets(
  input: ReceiverScope & { db: SQL; records: Omit<ReceivedRecord, 'assets'>[] },
): Promise<ReceivedRecord[]> {
  const references = input.records.map((record) => referencedAssetIds(record.data));
  const ids = [...new Set(references.flatMap((refs) => [...refs]))];
  const rows = ids.length
    ? await input.db<AssetRow[]>`SELECT id,source_id,name,media_type,size FROM host_assets
    WHERE owner_id=${input.ownerId} AND id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`
    : [];
  const byId = new Map(rows.map((row) => [row.id, asset(row)]));
  // biome-ignore lint/complexity/useMaxParams: Array.map supplies the record index.
  return input.records.map((record, index) => ({
    ...record,
    assets: [...references[index]!].flatMap((id) => {
      const found = byId.get(id);
      return found?.sourceId === record.sourceId ? [found] : [];
    }),
  }));
}
