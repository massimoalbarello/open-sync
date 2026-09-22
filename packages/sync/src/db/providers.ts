import { Database } from 'bun:sqlite';
import schema from './providers.sql' with { type: 'text' };

export function openProviderDatabase(path: string) {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    db.transaction(() => db.exec(schema)).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
