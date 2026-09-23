CREATE TABLE host_assets (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY(owner_id, id),
  UNIQUE(owner_id, idempotency_key),
  UNIQUE(owner_id, sync_id, asset_id, asset_version)
);

CREATE INDEX host_assets_file_id ON host_assets(file_id);
CREATE INDEX host_assets_updated_at ON host_assets(owner_id, updated_at DESC, id);

ALTER TABLE host_records ADD COLUMN asset_ids TEXT NOT NULL DEFAULT '[]';
