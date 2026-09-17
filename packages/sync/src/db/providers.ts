import { Database } from 'bun:sqlite';
import { fail } from '../models/error';
import schema from './providers.sql' with { type: 'text' };

export function openProviderDatabase(path: string) {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    db.transaction(() => {
      const version = db
        .query<{ user_version: number }, []>('PRAGMA user_version')
        .get()!.user_version;
      if (version === 0) {
        db.exec(schema);
      } else if (version !== 1) {
        fail('provider_schema_version');
      }
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
