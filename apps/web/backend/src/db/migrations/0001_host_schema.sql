CREATE TABLE host_settings (
  owner_id TEXT PRIMARY KEY,
  paused INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE host_receipts (
  owner_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  PRIMARY KEY(owner_id, delivery_id)
);
CREATE TABLE host_records (
  owner_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  data TEXT,
  content TEXT,
  preview TEXT,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY(owner_id, source_id, kind, record_id)
);

CREATE INDEX host_records_updated_at ON host_records(owner_id, updated_at DESC, source_id, kind, record_id) WHERE deleted=0;
