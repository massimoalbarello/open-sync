import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Crontab } from '../src/execution/crontab';
import { isolatedCrontab } from './cron-support';

test('one recurring crontab entry preserves other hosts and unrelated jobs', async () => {
  await using f = await isolatedCrontab();
  const unrelated = '# retained exactly\nCRON_TZ=Europe/London\n0 1 * * * /existing/task\n';
  await Bun.write(f.table, unrelated);
  const first = new Crontab({
    id: 'first',
    command: ['/app/host', 'a b', "it's", '$(do-not-execute)'],
    executable: f.executable,
  });
  const second = new Crontab({
    id: 'second',
    command: ['/app/other'],
    executable: f.executable,
  });
  await Promise.all([first.install(), second.install()]);
  const table = await f.table.text();
  expect(table).toContain("*/30 * * * * '/app/host' 'a b' 'it'\\''s' '$(do-not-execute)'\n");
  expect(table).toContain("*/30 * * * * '/app/other'\n");
  expect(table.endsWith(unrelated)).toBe(true);
  await first.install();
  expect(await f.table.text()).toContain("*/30 * * * * '/app/host'");
  expect((await f.table.text()).match(/\/app\/host/g)).toHaveLength(1);
  await first.remove();
  expect(await f.table.text()).toContain('/app/other');
  await second.remove();
  expect(await f.table.text()).toBe(unrelated);
});

test('registration failures cannot replace an unreadable table and can be retried', async () => {
  await using f = await isolatedCrontab();
  const retained = '0 1 * * * /existing/task\n';
  await Bun.write(f.table, retained);
  await Bun.write(join(f.directory, 'deny'), '');
  const cron = new Crontab({
    id: 'test',
    command: ['/app/host'],
    executable: f.executable,
  });
  await expect(cron.install()).rejects.toThrow('permission denied');
  expect(await f.table.text()).toBe(retained);
  await Bun.file(join(f.directory, 'deny')).delete();
  await cron.install();
  expect(await f.table.text()).toContain('/app/host');
});

test('a fresh registration restores jobs after the deployment cleared its table', async () => {
  await using f = await isolatedCrontab();
  const options = { id: 'test', command: ['/app/host'], executable: f.executable };
  await new Crontab(options).install();
  await Bun.write(f.table, '');
  await new Crontab(options).install();
  expect(await f.table.text()).toContain('/app/host');
});

test('commands with cron-specific syntax are refused before touching the table', () => {
  for (const command of [['/app/a\nb'], ['/app/a%b'], ['/app/a\0b']]) {
    expect(() => new Crontab({ id: 'test', command })).toThrow('Cron command arguments');
  }
});

test('separate host processes preserve each other when they register concurrently', async () => {
  await using f = await isolatedCrontab();
  const children = ['first', 'second'].map((id) =>
    Bun.spawn([process.execPath, join(import.meta.dir, 'crontab-writer.ts'), id, f.executable], {
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );
  for (const child of children) {
    expect(await new Response(child.stderr).text()).toBe('');
    expect(await child.exited).toBe(0);
  }
  const table = await f.table.text();
  expect(table).toContain('/host/first');
  expect(table).toContain('/host/second');
});
