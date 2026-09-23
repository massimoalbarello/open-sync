import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const temporary = await mkdtemp(join(tmpdir(), 'open-sync-package-'));
const execution = await mkdtemp(join(tmpdir(), 'open-sync-executable-'));
const packages = [
  { directory: 'packages/sync', archive: 'sync' },
  { directory: 'examples/integrations', archive: 'syncs' },
];
async function run(input: { cwd: string; command: string[] }) {
  const child = Bun.spawn(input.command, { cwd: input.cwd, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) {
    throw new Error('Package verification failed');
  }
}
try {
  for (const entry of packages) {
    await run({
      cwd: join(root, entry.directory),
      command: ['bun', 'pm', 'pack', '--filename', join(temporary, `${entry.archive}.tgz`)],
    });
  }
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      name: 'independent-host',
      private: true,
      type: 'module',
      overrides: { '@context-use/open-sync': './sync.tgz' },
      dependencies: {
        '@context-use/open-sync': './sync.tgz',
        '@open-sync/examples': './syncs.tgz',
      },
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
  await writeFile(
    join(temporary, 'adapter.ts'),
    `import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { gmailThreads } from '@open-sync/examples/syncs/gmail';
import { slackThreads } from '@open-sync/examples/syncs/slack';
import { granolaMeetings } from '@open-sync/examples/syncs/granola';
import { localDestination } from '@open-sync/examples/destinations/local';
for (const source of [githubPullRequests, gmailThreads, slackThreads, granolaMeetings]) {
  const definition = await source.load();
  if (typeof definition.step !== 'function') throw new Error('Missing source implementation');
}
const local = localDestination({ accept: async () => {} });
if (typeof local.deliver !== 'function') throw new Error('Missing destination implementation');
`,
  );
  await run({ cwd: temporary, command: ['bun', 'adapter.ts'] });
} finally {
  await rm(temporary, { recursive: true, force: true });
  await rm(execution, { recursive: true, force: true });
  for (const entry of packages) {
    await rm(join(root, entry.directory, 'LICENSE'), { force: true });
  }
}
