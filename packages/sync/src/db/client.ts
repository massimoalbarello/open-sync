import { Database } from 'bun:sqlite';
import { fail } from '../models/error';
import polls from './polls.sql' with { type: 'text' };
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
      } else if (version !== 1 && version !== 2) {
        fail('schema_version');
      }
      if (version < 2) {
        db.exec(polls);
      }
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
