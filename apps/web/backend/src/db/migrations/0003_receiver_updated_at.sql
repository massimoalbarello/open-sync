CREATE INDEX host_records_updated_at ON host_records(owner_id, updated_at DESC, source_id, kind, record_id) WHERE deleted=0;
CREATE INDEX host_assets_updated_at ON host_assets(owner_id, updated_at DESC, id);
