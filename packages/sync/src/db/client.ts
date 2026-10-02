import { Database } from 'bun:sqlite';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate';

export function openDatabase(path: string): Database {
  // Keep in-memory databases private while both startup connections share the same database.
  const filename =
    path === ':memory:' ? `file:open-sync-${crypto.randomUUID()}?mode=memory&cache=shared` : path;
  // Unlike bun:sqlite in Bun 1.4.0, this driver propagates failures inside SQL batches.
  using migration = new DatabaseSync(filename);
  migration.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  runMigrations(migration);
  const db = new Database(filename, { create: true, strict: true });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
