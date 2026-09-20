CREATE TABLE assets (
  owner_id TEXT NOT NULL, source_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
  metadata TEXT NOT NULL, file_id TEXT, size INTEGER NOT NULL DEFAULT 0, sha256 TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, committed INTEGER NOT NULL DEFAULT 0, stored_at INTEGER NOT NULL DEFAULT 0, error_code TEXT, state TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY(owner_id, source_id, id, version)
);
CREATE TABLE delivery_assets (
  owner_id TEXT NOT NULL, delivery_id TEXT NOT NULL, source_id TEXT NOT NULL,
  asset_id TEXT NOT NULL, asset_version TEXT NOT NULL,
  PRIMARY KEY(owner_id, delivery_id, asset_id, asset_version),
  FOREIGN KEY(owner_id, delivery_id) REFERENCES deliveries(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id, source_id, asset_id, asset_version) REFERENCES assets(owner_id, source_id, id, version)
);
CREATE TABLE asset_receipts (
  owner_id TEXT NOT NULL, destination_id TEXT NOT NULL, source_id TEXT NOT NULL,
  asset_id TEXT NOT NULL, asset_version TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0, outcome TEXT,
  PRIMARY KEY(owner_id, destination_id, source_id, asset_id, asset_version),
  FOREIGN KEY(owner_id, destination_id) REFERENCES destinations(owner_id, id)
);
ALTER TABLE deliveries ADD COLUMN materialized TEXT;
PRAGMA user_version = 4;
