CREATE TABLE host_deliverables (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  files TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE(owner_id, id)
);

CREATE INDEX host_deliverables_sync ON host_deliverables(owner_id, sync_id, sequence DESC);
