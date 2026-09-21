ALTER TABLE host_records ADD COLUMN preview TEXT;
ALTER TABLE host_records ADD COLUMN created_at TEXT;
ALTER TABLE host_records ADD COLUMN updated_at TEXT;

ALTER TABLE host_assets ADD COLUMN created_at TEXT;
ALTER TABLE host_assets ADD COLUMN updated_at TEXT;
