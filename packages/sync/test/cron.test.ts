import { expect, test } from 'bun:test';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { startCron } from '../src/execution/cron';
import { isolatedScheduler, runRegisteredCron } from './cron-support';
import { alpha, configure, runtime } from './support';

const CRON_FIELDS = 5;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_SOCKET_MODE = 0o600;

test('a registered shell command invokes the existing headless runtime through its private socket', async () => {
  await using table = await isolatedScheduler();
  const f = runtime();
  const directory = join(table.directory, 'worker');
  const errors: unknown[] = [];
  try {
    const sync = await configure(f.engine);
    await using cron = await startCron({
      runtime: f.engine,
      directory,
      onError: (error) => errors.push(error),
    });
    const registered = await table.table.text();
    expect(registered).toContain('0,30 * * * *');
    const entry = registered.split('\n').find((line) => line && !line.startsWith('#'))!;
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
      startCron({
        runtime: f.engine,
        directory,
        onError: () => {},
      }),
    ).rejects.toThrow('already owns');
    await f.engine.api.setEnabled({ ...alpha, id: sync.id, enabled: false });
    await runRegisteredCron(table.table);
    expect(f.engine.api.polls({ ...alpha, id: sync.id }).polls).toHaveLength(1);
    expect(await table.table.text()).toBe(registered);
    expect(errors).toEqual([]);
    await f.engine.close();
    await cron.close();
    expect(await table.table.text()).toBe('');
  } finally {
    await f.close();
  }
});

test('registration failure closes the socket and leaves unrelated crontab entries intact', async () => {
  await using table = await isolatedScheduler();
  const f = runtime();
  const directory = join(table.directory, 'worker');
  const retained = '0 1 * * * /existing/task\n';
  await Bun.write(table.table, retained);
  await Bun.write(join(table.directory, 'deny'), '');
  try {
    await expect(
      startCron({
        runtime: f.engine,
        directory,
        onError: () => {},
      }),
    ).rejects.toThrow();
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
  await using table = await isolatedScheduler();
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
    await using cron = await startCron({
      runtime: f.engine,
      directory,
      onError: () => {},
    });
    await runRegisteredCron(table.table);
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

test('a failed or missed invocation leaves the next recurring wake-up available', async () => {
  await using table = await isolatedScheduler();
  const directory = join(table.directory, 'worker');
  const errors: unknown[] = [];
  let attempts = 0;
  await using cron = await startCron({
    directory,
    runtime: {
      runDue() {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error('temporary failure')) : Promise.resolve();
      },
    },
    onError: (error) => errors.push(error),
  });
  const registered = await table.table.text();
  const expression = registered
    .split('\n')
    .find((line) => line && !line.startsWith('#'))!
    .split(' ')
    .slice(0, CRON_FIELDS)
    .join(' ');
  const missed = Date.parse('2030-01-02T03:00:00Z');
  const next = Date.parse('2030-01-02T03:30:00Z');
  expect(Bun.cron.parse(expression, missed + 1, { tz: 'UTC' })?.getTime()).toBe(next);
  await expect(runRegisteredCron(table.table)).rejects.toThrow('503');
  expect(await table.table.text()).toBe(registered);
  await runRegisteredCron(table.table);
  expect(attempts).toBe(2);
  expect(errors).toHaveLength(1);
  expect(await table.table.text()).toBe(registered);
  await cron.close();
});

test('runtime startup reports cron registration failure before starting sync work', async () => {
  await using table = await isolatedScheduler();
  const f = runtime();
  try {
    const sync = await configure(f.engine);
    await Bun.write(join(table.directory, 'deny'), '');
    await expect(f.engine.start()).rejects.toThrow();
    expect(f.engine.api.polls({ ...alpha, id: sync.id }).polls).toHaveLength(0);
    await f.engine.close();
    expect(await table.table.exists()).toBe(false);
  } finally {
    await f.close();
  }
});
