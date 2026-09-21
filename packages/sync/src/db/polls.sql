CREATE TABLE polls (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, installation_id TEXT NOT NULL,
  state TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER,
  records_processed INTEGER NOT NULL DEFAULT 0, records_changed INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id, id),
  FOREIGN KEY(owner_id, installation_id) REFERENCES installations(owner_id, id)
);
CREATE UNIQUE INDEX one_open_poll ON polls(owner_id, installation_id) WHERE completed_at IS NULL;
ALTER TABLE runs ADD COLUMN poll_id TEXT;
ALTER TABLE runs ADD COLUMN records_processed INTEGER;
ALTER TABLE runs ADD COLUMN records_changed INTEGER;
CREATE INDEX poll_attempts ON runs(owner_id, poll_id, started_at);
PRAGMA user_version = 2;
