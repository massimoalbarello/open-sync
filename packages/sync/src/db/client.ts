import { Database } from 'bun:sqlite';
import schema from './schema.sql' with { type: 'text' };

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    db.transaction(() => db.exec(schema)).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
