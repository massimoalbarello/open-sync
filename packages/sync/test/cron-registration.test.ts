import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { isolatedCrontab, runRegisteredCron } from './cron-support';

function host(input: { path: string; directory: string }) {
  return Bun.spawn([process.execPath, join(import.meta.dir, 'cron-host.ts'), input.directory], {
    env: { ...process.env, PATH: input.path },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  });
}

test.skipIf(process.platform !== 'linux')(
  'concurrent hosts preserve each other and source cron runs outside the host environment',
  async () => {
    await using table = await isolatedCrontab();
    const retained = '0 1 * * * /existing/task\n';
    await Bun.write(table.table, retained);
    const directory = join(table.directory, 'worker');
    const children = [directory, `${directory}-other`].map((directory) =>
      host({ path: `${table.directory}:${process.env.PATH}`, directory }),
    );
    try {
      await Promise.all(
        children.map(async (child) => {
          const reader = child.stdout.getReader();
          expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
          reader.releaseLock();
        }),
      );
      expect((await table.table.text()).match(/# bun-cron:/g)).toHaveLength(2);
      expect(await table.table.text()).toContain(retained);
      await runRegisteredCron(table.table);
      expect(
        (await Bun.file(join(directory, 'ran')).exists()) ||
          (await Bun.file(join(`${directory}-other`, 'ran')).exists()),
      ).toBe(true);
      children[0]!.kill('SIGTERM');
      expect(await children[0]!.exited).toBe(0);
      expect((await table.table.text()).match(/# bun-cron:/g)).toHaveLength(1);
    } finally {
      for (const child of children) {
        if (child.exitCode === null) {
          child.kill('SIGTERM');
        }
        expect(await child.exited).toBe(0);
      }
    }
    expect(await table.table.text()).toBe(retained);
  },
);

test.skipIf(process.platform !== 'linux')(
  'a crontab read failure cannot overwrite existing schedules',
  async () => {
    await using table = await isolatedCrontab();
    const retained = '0 1 * * * /existing/task\n';
    await Bun.write(table.table, retained);
    await Bun.write(join(table.directory, 'read-failure'), '');
    const child = host({
      path: `${table.directory}:${process.env.PATH}`,
      directory: join(table.directory, 'worker'),
    });
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(error).toContain('cron service unavailable');
    expect(await table.table.text()).toBe(retained);
  },
);
