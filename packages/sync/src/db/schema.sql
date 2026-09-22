CREATE TABLE definitions (
  id TEXT NOT NULL, version TEXT NOT NULL, artifact_id TEXT NOT NULL, manifest TEXT NOT NULL,
  PRIMARY KEY(id, version)
);
CREATE TABLE destinations (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, version TEXT NOT NULL, config TEXT NOT NULL,
  PRIMARY KEY(owner_id, id)
);
CREATE TABLE installations (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL,
  definition_id TEXT NOT NULL, definition_version TEXT NOT NULL, artifact_id TEXT NOT NULL,
  connection TEXT, config TEXT NOT NULL, destination_id TEXT NOT NULL,
  enabled INTEGER NOT NULL, binding_epoch INTEGER NOT NULL DEFAULT 1,
  checkpoint TEXT NOT NULL, checkpoint_revision INTEGER NOT NULL DEFAULT 0,
  interval_ms INTEGER NOT NULL, next_due_at INTEGER NOT NULL, status TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id, id), UNIQUE(owner_id, source_id),
  FOREIGN KEY(owner_id, destination_id) REFERENCES destinations(owner_id, id)
);
CREATE TABLE polls (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, installation_id TEXT NOT NULL,
  state TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER,
  records_processed INTEGER NOT NULL DEFAULT 0, records_changed INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id, id),
  FOREIGN KEY(owner_id, installation_id) REFERENCES installations(owner_id, id)
);
CREATE UNIQUE INDEX one_open_poll ON polls(owner_id, installation_id) WHERE completed_at IS NULL;
CREATE TABLE runs (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, installation_id TEXT NOT NULL,
  definition_ref TEXT NOT NULL, binding_epoch INTEGER NOT NULL,
  worker_id TEXT NOT NULL, generation INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  poll_id TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER,
  records_processed INTEGER NOT NULL DEFAULT 0, records_changed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id, id),
  FOREIGN KEY(owner_id, installation_id) REFERENCES installations(owner_id, id),
  FOREIGN KEY(owner_id, poll_id) REFERENCES polls(owner_id, id)
);
CREATE UNIQUE INDEX one_acquisition ON runs(owner_id,installation_id) WHERE state='running';
CREATE INDEX poll_attempts ON runs(owner_id, poll_id, started_at);
CREATE TABLE records (
  owner_id TEXT NOT NULL, installation_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
  hash TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL,
  PRIMARY KEY(owner_id, installation_id, kind, id),
  FOREIGN KEY(owner_id, installation_id) REFERENCES installations(owner_id, id)
);
CREATE TABLE deliveries (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, id TEXT NOT NULL,
  installation_id TEXT NOT NULL, destination_id TEXT NOT NULL, body TEXT NOT NULL,
  bytes INTEGER NOT NULL, record_count INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  due_at INTEGER NOT NULL, worker_id TEXT, generation INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER, attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT, materialized TEXT,
  UNIQUE(owner_id, id),
  FOREIGN KEY(owner_id, installation_id) REFERENCES installations(owner_id, id),
  FOREIGN KEY(owner_id, destination_id) REFERENCES destinations(owner_id, id)
);
CREATE INDEX delivery_order ON deliveries(owner_id,installation_id,destination_id,sequence);
CREATE INDEX deliveries_due ON deliveries(state, due_at);
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
