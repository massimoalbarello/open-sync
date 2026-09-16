import { Database } from 'bun:sqlite';
import { fail } from '../models/error';
import schema from './schema.sql' with { type: 'text' };

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
      } else if (version !== 1) {
        fail('schema_version');
      }
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
