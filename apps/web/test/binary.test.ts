const HTTP_NOT_FOUND = 404;
const HTTP_OK = 200;
const MAX_NIBRUN_BINARY_BYTES = 256_000_000;

import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBinary } from '@repo/build-tools/binary-check';
import { SQL } from 'bun';
import { isolatedCrontab } from '../../../packages/sync/test/cron-support';

test('standalone binary embeds frontend and migrations and preserves state on restart', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'binary-test-'));
  try {
    const executable = join(import.meta.dir, '../dist/app');
    expect(Bun.file(executable).size).toBeLessThanOrEqual(MAX_NIBRUN_BINARY_BYTES);
    const dataFolder = join(folder, 'data');
    await using app = await startBinary({
      executable,
      cwd: folder,
      env: { DATA_FOLDER: dataFolder, BASE_URL: 'http://localhost:3000', SYNC_SCHEDULER: 'timer' },
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
    for (const path of ['/syncs', '/syncs/example', '/syncs/example/deliverables/bundle']) {
      expect((await app.request({ path })).status).toBe(HTTP_OK);
    }
    expect((await app.request({ path: '/api/missing' })).status).toBe(HTTP_NOT_FOUND);
    expect((await app.request({ path: '/missing.js' })).status).toBe(HTTP_NOT_FOUND);
    expect((await app.request({ path: '/login' })).status).toBe(HTTP_OK);
    await app.stop();
    const secret = await Bun.file(join(dataFolder, '.better-auth-secret')).text();
    const db = new SQL({ adapter: 'sqlite', filename: join(dataFolder, 'app.db') });
    try {
      const expectedMigrations = [
        ...new Bun.Glob('**/*.sql').scanSync({
          cwd: join(import.meta.dir, '../backend/src/db/migrations'),
          onlyFiles: true,
        }),
      ].sort();
      const migrations = await db<{ name: string }[]>`select name from __migrations order by name`;
      expect(migrations.map((migration) => migration.name)).toEqual(expectedMigrations);
    } finally {
      await db.close();
    }
    await using restarted = await startBinary({
      executable,
      cwd: folder,
      env: { DATA_FOLDER: dataFolder, BASE_URL: 'http://localhost:3000', SYNC_SCHEDULER: 'timer' },
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

test('standalone host defaults to crontab and handles its task before server initialization', async () => {
  await using crontab = await isolatedCrontab();
  const executable = join(import.meta.dir, '../dist/app');
  const dataFolder = join(crontab.directory, 'data');
  await using app = await startBinary({
    executable,
    cwd: crontab.directory,
    env: { DATA_FOLDER: dataFolder, PATH: `${crontab.directory}:${process.env.PATH}` },
  });
  const taskTimeoutMs = 5_000;
  const unusedData = join(crontab.directory, 'must-not-be-created');
  const child = Bun.spawn([executable, '--open-sync-cron', join(dataFolder, '.cron/worker.sock')], {
    env: { DATA_FOLDER: unusedData, PORT: 'invalid', SYNC_SCHEDULER: 'invalid' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: taskTimeoutMs,
  });
  expect(await new Response(child.stderr).text()).toBe('');
  expect(await child.exited).toBe(0);
  expect(await Bun.file(join(unusedData, 'app.db')).exists()).toBe(false);
  expect((await app.request({ path: '/api/health' })).status).toBe(HTTP_OK);
  await app.stop();
});
