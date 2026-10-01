import { expect, test } from 'bun:test';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runCronCommand, startCrontab } from '../src/cron';
import { isolatedCrontab } from './cron-support';
import { alpha, configure, runtime } from './support';

const CRON_FIELDS = 5;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_SOCKET_MODE = 0o600;

test('a registered shell command invokes the existing headless runtime through its private socket', async () => {
  await using table = await isolatedCrontab();
  const f = runtime();
  const directory = join(table.directory, 'worker');
  const errors: unknown[] = [];
  try {
    const sync = await configure(f.engine);
    await using cron = await startCrontab({
      runtime: f.engine,
      directory,
      command: [process.execPath, join(import.meta.dir, 'cron-command.ts')],
      crontabExecutable: table.executable,
      onError: (error) => errors.push(error),
    });
    const entry = (await table.table.text())
      .split('\n')
      .find((line) => line && !line.startsWith('#'))!;
    const command = entry.split(' ').slice(CRON_FIELDS).join(' ');
    const children = Array.from({ length: 2 }, () =>
      Bun.spawn(['/bin/sh', '-c', command], { stdout: 'pipe', stderr: 'pipe' }),
    );
    for (const child of children) {
      expect(await new Response(child.stderr).text()).toBe('');
      expect(await child.exited).toBe(0);
    }
    expect(f.engine.api.polls({ ...alpha, id: sync.id }).polls).toHaveLength(1);
    expect(f.engine.api.status(alpha).queue.pendingRecords).toBe(0);
    expect((await stat(directory)).mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE);
    expect((await stat(join(directory, 'worker.sock'))).mode & 0o777).toBe(PRIVATE_SOCKET_MODE);
    await expect(
      startCrontab({
        runtime: f.engine,
        directory,
        command: ['/ignored'],
        crontabExecutable: table.executable,
        onError: () => {},
      }),
    ).rejects.toThrow('already owns');
    expect(errors).toEqual([]);
    await f.engine.close();
    await cron.close();
    expect(await table.table.text()).toBe('');
  } finally {
    await f.close();
  }
});

test('cron command handling leaves unrelated host arguments alone and fails on malformed tasks', async () => {
  expect(await runCronCommand({ args: ['serve'] })).toBe(false);
  await expect(runCronCommand({ args: ['--open-sync-cron'] })).rejects.toThrow('requires');
});

test('registration failure closes the socket and leaves unrelated crontab entries intact', async () => {
  await using table = await isolatedCrontab();
  const f = runtime();
  const directory = join(table.directory, 'worker');
  const retained = '0 1 * * * /existing/task\n';
  await Bun.write(table.table, retained);
  await Bun.write(join(table.directory, 'deny'), '');
  try {
    await expect(
      startCrontab({
        runtime: f.engine,
        directory,
        command: ['/host'],
        crontabExecutable: table.executable,
        onError: () => {},
      }),
    ).rejects.toThrow('permission denied');
    expect(
      await stat(join(directory, 'worker.sock')).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(await table.table.text()).toBe(retained);
  } finally {
    await f.close();
  }
});

test('a restarted host recovers a socket left by a killed process', async () => {
  await using table = await isolatedCrontab();
  const f = runtime();
  const directory = join(table.directory, 'worker');
  await mkdir(directory);
  const socket = join(directory, 'worker.sock');
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `Bun.serve({unix: ${JSON.stringify(socket)}, fetch: () => new Response()}); console.log('ready');`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  try {
    const reader = child.stdout.getReader();
    await reader.read();
    reader.releaseLock();
    child.kill('SIGKILL');
    await child.exited;
    await using cron = await startCrontab({
      runtime: f.engine,
      directory,
      command: ['/host'],
      crontabExecutable: table.executable,
      onError: () => {},
    });
    expect(await runCronCommand({ args: ['--open-sync-cron', socket] })).toBe(true);
    await f.engine.close();
    await cron.close();
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await child.exited;
    }
    await f.close();
  }
});
