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
    console.error('no crontab for test');
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
