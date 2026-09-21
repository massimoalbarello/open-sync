import type { SQL } from 'bun';
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
  input: ReceiverScope & {
    db: SQL;
    records: (Omit<ReceivedRecord, 'assets'> & { assetIds: string[] })[];
  },
): Promise<ReceivedRecord[]> {
  const ids = [...new Set(input.records.flatMap((record) => record.assetIds))];
  const rows = ids.length
    ? await input.db<AssetRow[]>`SELECT id,source_id,name,media_type,size FROM host_assets
    WHERE owner_id=${input.ownerId} AND id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`
    : [];
  const byId = new Map(rows.map((row) => [row.id, asset(row)]));
  return input.records.map(({ assetIds, ...record }) => ({
    ...record,
    assets: assetIds.flatMap((id) => {
      const found = byId.get(id);
      return found?.sourceId === record.sourceId ? [found] : [];
    }),
  }));
}
