import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { runMigrations } from '#backend/db/migrate.ts';

test('fresh schema arbitrates concurrent first-account claims', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'single-owner-'));
  const db = new SQL({ adapter: 'sqlite', filename: join(dir, 'app.db') });
  try {
    await runMigrations({ db });
    const attempts = await Promise.allSettled(
      ['first', 'second'].map(
        (id) => db`
        INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt)
        VALUES (${id},'Owner',${`${id}@accounts.invalid`},0,'2026-09-16','2026-09-16')`,
      ),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db<{ count: number }[]>`SELECT count(*) AS count FROM auth_user`).toEqual([
      { count: 1 },
    ]);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
