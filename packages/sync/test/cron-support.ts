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
    `#!${process.execPath}
const directory = import.meta.dir;
if (await Bun.file(directory + '/deny').exists()) {
  console.error('permission denied');
  process.exit(1);
}
const table = Bun.file(directory + '/table');
if (process.argv[2] === '-l') {
  if (!(await table.exists())) {
    const missing = Bun.file(directory + '/missing-table-error');
    console.error(await missing.exists() ? await missing.text() : 'no crontab for test');
    process.exit(1);
  }
  process.stdout.write(await table.text());
} else if (process.argv[2] === '-') {
  await Bun.write(table, await Bun.stdin.text());
} else {
  process.exit(2);
}
`,
  );
  await chmod(executable, PRIVATE_EXECUTABLE_MODE);
  return {
    directory,
    executable,
    table: Bun.file(join(directory, 'table')),
    async [Symbol.asyncDispose]() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Execute the exact command registered in the private table, as the OS cron daemon would. */
export async function runRegisteredCron(table: Bun.BunFile) {
  const fields = 5;
  const entry = (await table.text()).split('\n').find((line) => line && !line.startsWith('#'))!;
  const child = Bun.spawn(['/bin/sh', '-c', entry.split(' ').slice(fields).join(' ')], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code) {
    throw new Error(error || `Cron command failed: ${code}`);
  }
}
