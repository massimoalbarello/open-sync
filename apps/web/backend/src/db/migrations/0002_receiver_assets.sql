CREATE TABLE host_assets (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY(owner_id, id),
  UNIQUE(owner_id, idempotency_key),
  UNIQUE(owner_id, source_id, asset_id, asset_version)
);
