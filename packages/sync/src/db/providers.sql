CREATE TABLE IF NOT EXISTS provider_authorizations (
  owner_id TEXT NOT NULL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  service TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_connections (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  connector_id TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL,
  service TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
