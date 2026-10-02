import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRIVATE_EXECUTABLE_MODE = 0o700;

/** A real subprocess boundary with a disposable crontab, never the developer's OS table. */
export async function isolatedCrontab() {
  const directory = await mkdtemp(join(tmpdir(), 'sync-crontab-'));
  const executable = join(directory, 'crontab');
  await writeFile(
    executable,
    `#!/bin/sh
if [ -f '${directory}/deny' ]; then
  echo 'permission denied' >&2
  exit 1
fi
if [ "$1" = '-l' ]; then
  if [ -f '${directory}/read-failure' ]; then
    echo 'cron service unavailable' >&2
    exit 1
  fi
  if [ -f '${directory}/table' ]; then
    /bin/cat '${directory}/table'
  else
    echo 'no crontab for test' >&2
    exit 1
  fi
else
  /bin/cat "$1" > '${directory}/table'
fi
`,
  );
  await chmod(executable, PRIVATE_EXECUTABLE_MODE);
  return {
    directory,
    executable,
    get table() {
      return Bun.file(join(directory, 'table'));
    },
    async [Symbol.asyncDispose]() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Replace OS registration for worker tests; binary tests exercise Bun.cron itself. */
export async function isolatedScheduler() {
  const table = await isolatedCrontab();
  const previousPath = process.env.PATH;
  const original = Bun.cron;
  process.env.PATH = `${table.directory}:${previousPath}`;
  const update = async (input: { title: string; entry?: string }) => {
    if (await Bun.file(join(table.directory, 'deny')).exists()) {
      throw new Error('Process exited with code 1');
    }
    const lines = ((await table.table.exists()) ? await table.table.text() : '').split('\n');
    const marker = `# bun-cron: ${input.title}`;
    const index = lines.indexOf(marker);
    if (index >= 0) {
      lines.splice(index, 2);
    }
    const remaining = lines.filter(Boolean);
    if (input.entry) {
      remaining.push(marker, input.entry);
    }
    await Bun.write(table.table, remaining.length ? `${remaining.join('\n')}\n` : '');
  };
  // biome-ignore lint/complexity/useMaxParams: Match the Bun.cron registration API.
  const register = async (path: string, _schedule: string, title: string) => {
    const schedule = '0,30 * * * *';
    await update({
      title,
      entry: `${schedule} '${process.execPath}' run --cron-title=${title} --cron-period='${schedule}' '${path}'`,
    });
  };
  Object.defineProperty(Bun, 'cron', {
    value: Object.assign(register, {
      parse: original.parse,
      remove: (title: string) => update({ title }),
    }) as typeof Bun.cron,
  });
  return {
    ...table,
    get table() {
      return table.table;
    },
    async [Symbol.asyncDispose]() {
      Object.defineProperty(Bun, 'cron', { value: original });
      process.env.PATH = previousPath;
      await table[Symbol.asyncDispose]();
    },
  };
}

/** Execute the exact command registered in the private table, as the OS cron daemon would. */
export async function runRegisteredCron(table: Bun.BunFile) {
  const fields = 5;
  const entry = (await table.text())
    .split('\n')
    .find((line) => line.includes('--cron-title=open-sync-'))!;
  const child = Bun.spawn(['/bin/sh', '-c', entry.split(' ').slice(fields).join(' ')], {
    cwd: '/',
    env: { PATH: '/usr/bin:/bin', PORT: 'invalid', DATA_FOLDER: '/must-not-be-created' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code) {
    throw new Error(error || `Cron command failed: ${code}`);
  }
}
