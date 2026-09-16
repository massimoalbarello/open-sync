const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_OK = 200;

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
    const dataFolder = join(folder, 'data');
    await using app = await startBinary({
      executable,
      cwd: folder,
      env: { DATA_FOLDER: dataFolder, BASE_URL: 'http://localhost:3000' },
    });
    expect((await app.request({ path: '/api/health' })).status).toBe(HTTP_OK);
    expect((await app.request({ path: '/api/auth/get-session' })).status).toBe(HTTP_OK);
    const html = await (await app.request({ path: '/' })).text();
    expect(html).toContain('Notebook');
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(asset).toBeDefined();
    const javascript = await app.request({ path: asset! });
    expect(javascript.status).toBe(HTTP_OK);
    expect(javascript.headers.get('content-type')).toContain('javascript');
    expect((await app.request({ path: '/api/missing' })).status).toBe(HTTP_NOT_FOUND);
    expect((await app.request({ path: '/missing.js' })).status).toBe(HTTP_NOT_FOUND);
    expect((await app.request({ path: '/login' })).status).toBe(HTTP_OK);
    expect((await app.request({ path: '/api/notes' })).status).toBe(HTTP_UNAUTHORIZED);
    await app.stop();
    const secret = await Bun.file(join(dataFolder, '.better-auth-secret')).text();
    const db = new SQL({ adapter: 'sqlite', filename: join(dataFolder, 'app.db') });
    try {
      expect((await db`select name from __migrations`).length).toBe(2);
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
    await restarted.stop();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
