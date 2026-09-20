import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const temporary = await mkdtemp(join(tmpdir(), 'open-sync-package-'));
const execution = await mkdtemp(join(tmpdir(), 'open-sync-executable-'));
const license = join(root, 'packages/sync/LICENSE');
async function run(input: { cwd: string; command: string[] }) {
  const child = Bun.spawn(input.command, { cwd: input.cwd, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) {
    throw new Error('Package verification failed');
  }
}
try {
  await run({
    cwd: join(root, 'packages/sync'),
    command: ['bun', 'pm', 'pack', '--filename', join(temporary, 'core.tgz')],
  });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      name: 'independent-host',
      private: true,
      type: 'module',
      dependencies: { '@context-use/open-sync': './core.tgz' },
    }),
  );
  await run({ cwd: temporary, command: ['bun', 'install', '--ignore-scripts'] });
  await writeFile(
    join(temporary, 'consumer.ts'),
    await readFile(join(root, 'packages/sync/test/package-consumer.ts')),
  );
  await run({ cwd: temporary, command: ['bun', 'consumer.ts'] });
  await writeFile(
    join(temporary, 'build.ts'),
    await readFile(join(root, 'packages/sync/test/package-build.ts')),
  );
  await run({ cwd: temporary, command: ['bun', 'build.ts', 'github'] });
  await copyFile(join(temporary, 'consumer'), join(execution, 'consumer'));
  await run({ cwd: execution, command: ['./consumer', 'github'] });
  await run({ cwd: temporary, command: ['bun', 'build.ts'] });
  await copyFile(join(temporary, 'consumer'), join(execution, 'consumer'));
  await run({ cwd: execution, command: ['./consumer', 'empty'] });
} finally {
  await rm(temporary, { recursive: true, force: true });
  await rm(execution, { recursive: true, force: true });
  await rm(license, { force: true });
}
