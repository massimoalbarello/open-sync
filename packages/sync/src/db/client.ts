import { Database } from 'bun:sqlite';
import { SyncError } from '../models/error';
import schema from './schema.sql' with { type: 'text' };

const schemaVersion = 6;

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    db.transaction(() => {
      const { user_version: version } = db
        .query<{ user_version: number }, []>('PRAGMA user_version')
        .get()!;
      if (version === 0) {
        db.exec(schema);
        db.exec(`PRAGMA user_version=${schemaVersion}`);
      } else if (version !== schemaVersion) {
        throw new SyncError({
          code: 'schema_version',
          message: 'Unsupported sync database schema. Start with a fresh database.',
        });
      }
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
