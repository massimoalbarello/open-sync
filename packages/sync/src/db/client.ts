import { Database } from 'bun:sqlite';
import { runMigrations } from './migrate';

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    runMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
