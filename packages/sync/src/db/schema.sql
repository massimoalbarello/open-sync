CREATE TABLE IF NOT EXISTS syncs (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, definition_id TEXT NOT NULL,
  connection TEXT, config TEXT NOT NULL, destination_type TEXT NOT NULL, destination_config TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  checkpoint TEXT NOT NULL,
  interval_ms INTEGER NOT NULL, next_due_at INTEGER NOT NULL, status TEXT NOT NULL,
  error_code TEXT,
  generation INTEGER NOT NULL DEFAULT 0, expires_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0, resync INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id, id)
);
CREATE TABLE IF NOT EXISTS record_state (
  owner_id TEXT NOT NULL, sync_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
  hash TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL,
  PRIMARY KEY(owner_id, sync_id, kind, id),
  FOREIGN KEY(owner_id, sync_id) REFERENCES syncs(owner_id, id)
);
CREATE TABLE IF NOT EXISTS deliveries (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, id TEXT NOT NULL,
  sync_id TEXT NOT NULL, body TEXT NOT NULL,
  bytes INTEGER NOT NULL, record_count INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  due_at INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER, attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT,
  UNIQUE(owner_id, id),
  FOREIGN KEY(owner_id, sync_id) REFERENCES syncs(owner_id, id)
);
CREATE INDEX IF NOT EXISTS delivery_order ON deliveries(owner_id,sync_id,sequence);
CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(state, due_at);
-- Staging, queued bytes, and pending cleanup share one delivery-owned ledger.
-- No foreign keys: cleanup must survive deletion of the delivery or sync.
CREATE TABLE IF NOT EXISTS delivery_assets (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sync_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  asset_id TEXT NOT NULL, asset_version TEXT NOT NULL,
  descriptor TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes>=0), delivery_id TEXT,
  UNIQUE(owner_id,sync_id,generation,asset_id,asset_version)
);
CREATE INDEX IF NOT EXISTS delivery_asset_queue ON delivery_assets(owner_id,delivery_id);
CREATE INDEX IF NOT EXISTS delivery_asset_sync ON delivery_assets(owner_id,sync_id);
