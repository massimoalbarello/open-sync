import { join } from 'node:path';
import { SQL } from 'bun';
import { ensureDir } from '#backend/lib/filesystem.ts';
export async function createSqliteDatabase({ dataFolder }: { dataFolder: string }) {
  ensureDir(dataFolder);
  const database = new SQL({ adapter: 'sqlite', filename: join(dataFolder, 'app.db') });
  try {
    await database.unsafe('PRAGMA foreign_keys = ON');
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}
