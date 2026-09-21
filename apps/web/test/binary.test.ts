const HTTP_NOT_FOUND = 404;
const HTTP_OK = 200;
const MAX_NIBRUN_BINARY_BYTES = 256_000_000;

import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBinary } from '@repo/build-tools/binary-check';
import { SQL } from 'bun';

test('standalone binary embeds frontend and migrations and preserves state on restart', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'binary-test-'));
  try {
    const executable = join(import.meta.dir, '../dist/app');
    expect(Bun.file(executable).size).toBeLessThanOrEqual(MAX_NIBRUN_BINARY_BYTES);
    const dataFolder = join(folder, 'data');
    await using app = await startBinary({
      executable,
      cwd: folder,
      env: { DATA_FOLDER: dataFolder, BASE_URL: 'http://localhost:3000' },
    });
    expect((await app.request({ path: '/api/health' })).status).toBe(HTTP_OK);
    expect((await app.request({ path: '/api/auth/get-session' })).status).toBe(HTTP_OK);
    const html = await (await app.request({ path: '/' })).text();
    expect(html).toContain('Open Sync');
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(asset).toBeDefined();
    const javascript = await app.request({ path: asset! });
    expect(javascript.status).toBe(HTTP_OK);
    expect(javascript.headers.get('content-type')).toContain('javascript');
    expect((await app.request({ path: '/api/missing' })).status).toBe(HTTP_NOT_FOUND);
    expect((await app.request({ path: '/missing.js' })).status).toBe(HTTP_NOT_FOUND);
    expect((await app.request({ path: '/login' })).status).toBe(HTTP_OK);
    await app.stop();
    const secret = await Bun.file(join(dataFolder, '.better-auth-secret')).text();
    const db = new SQL({ adapter: 'sqlite', filename: join(dataFolder, 'app.db') });
    try {
      const migrations = await db<{ name: string }[]>`select name from __migrations`;
      expect(migrations.map((migration) => migration.name)).toEqual([
        '0000_better_auth_schema.sql',
        '0001_host_schema.sql',
        '0002_receiver_assets.sql',
      ]);
    } finally {
      await db.close();
    }
    await using restarted = await startBinary({
      executable,
      cwd: folder,
      env: { DATA_FOLDER: dataFolder, BASE_URL: 'http://localhost:3000' },
    });
    expect((await restarted.request({ path: '/api/health' })).status).toBe(HTTP_OK);
    expect(await Bun.file(join(dataFolder, '.better-auth-secret')).text()).toBe(secret);
    expect((await restarted.request({ path: '/api/open-sync/v1/connections' })).status).toBe(
      HTTP_NOT_FOUND,
    );
    await restarted.stop();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
