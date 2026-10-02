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
  await using crontab = await isolatedCrontab();
  const folder = await mkdtemp(join(tmpdir(), 'binary-test-'));
  try {
    const executable = join(import.meta.dir, '../dist/app');
    expect(Bun.file(executable).size).toBeLessThanOrEqual(MAX_NIBRUN_BINARY_BYTES);
    const dataFolder = join(folder, 'data');
    await using app = await startBinary({
      executable,
      cwd: folder,
      env: {
        DATA_FOLDER: dataFolder,
        BASE_URL: 'http://localhost:3000',
        PATH: `${crontab.directory}:${process.env.PATH}`,
      },
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
      env: {
        DATA_FOLDER: dataFolder,
        BASE_URL: 'http://localhost:3000',
        PATH: `${crontab.directory}:${process.env.PATH}`,
      },
    });
    expect((await restarted.request({ path: '/api/health' })).status).toBe(HTTP_OK);
    expect(await Bun.file(join(dataFolder, '.better-auth-secret')).text()).toBe(secret);
    expect((await restarted.request({ path: '/api/open-sync/v1/connections' })).status).toBe(
      HTTP_NOT_FOUND,
    );
    await restarted.stop();
    expect(await crontab.table.text()).toBe('');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a standalone host registers cron automatically and its task never initializes a second app', async () => {
  await using crontab = await isolatedCrontab();
  const executable = join(import.meta.dir, '../dist/app');
  const dataFolder = join(crontab.directory, 'data');
  await using app = await startBinary({
    executable,
    cwd: crontab.directory,
    env: {
      DATA_FOLDER: dataFolder,
      PATH: `${crontab.directory}:${process.env.PATH}`,
    },
  });
  expect(await crontab.table.text()).toContain('*/30 * * * *');
  const taskTimeoutMs = 5_000;
  const unusedData = join(crontab.directory, 'must-not-be-created');
  const fields = 5;
  const entry = (await crontab.table.text())
    .split('\n')
    .find((line) => line && !line.startsWith('#'))!;
  const child = Bun.spawn(['/bin/sh', '-c', entry.split(' ').slice(fields).join(' ')], {
    env: { DATA_FOLDER: unusedData, PORT: 'invalid' },
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

test('a standalone host never accepts connections when cron registration fails', async () => {
  await using crontab = await isolatedCrontab();
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  await reservation.stop(true);
  await Bun.write(
    crontab.executable,
    `#!${process.execPath}
if (process.argv[2] === '-') {
  await Bun.stdin.text();
  const acceptingConnections = await Bun.connect({
    hostname: '127.0.0.1',
    port: Number(process.env.PORT),
    socket: { data() {} },
  }).then(socket => { socket.end(); return true; }, () => false);
  await Bun.write(import.meta.dir + '/accepting-connections', JSON.stringify(acceptingConnections));
  console.error('cron registration unavailable');
  process.exit(1);
}
`,
  );
  const startupTimeoutMs = 5_000;
  const child = Bun.spawn([join(import.meta.dir, '../dist/app')], {
    cwd: crontab.directory,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FOLDER: join(crontab.directory, 'data'),
      PATH: `${crontab.directory}:${process.env.PATH}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: startupTimeoutMs,
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).toBe(1);
  expect(stderr).toContain('cron registration unavailable');
  expect(stdout).not.toContain('Open Sync listening');
  expect(await Bun.file(join(crontab.directory, 'accepting-connections')).json()).toBe(false);
});
