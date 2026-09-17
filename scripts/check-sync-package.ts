import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const temporary = await mkdtemp(join(tmpdir(), 'open-sync-package-'));
const packages = [
  { directory: 'packages/sync', archive: 'sync' },
  { directory: 'packages/http-delivery', archive: 'http-delivery' },
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
      overrides: { '@open-sync/core': './sync.tgz' },
      dependencies: {
        '@open-sync/core': './sync.tgz',
        '@open-sync/http-delivery': './http-delivery.tgz',
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
    join(temporary, 'adapter.ts'),
    `import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { sampleSync } from '@open-sync/examples/syncs/sample';
if (typeof githubPullRequests.load !== 'function' || typeof sampleSync.load !== 'function') throw new Error('Missing example syncs');
import { createHttpDestination } from '@open-sync/http-delivery';
if (typeof createHttpDestination({ endpoint: 'https://receiver.example' }).deliver !== 'function') throw new Error('Missing HTTP adapter');
`,
  );
  await run({ cwd: temporary, command: ['bun', 'adapter.ts'] });
} finally {
  await rm(temporary, { recursive: true, force: true });
  for (const entry of packages) {
    await rm(join(root, entry.directory, 'LICENSE'), { force: true });
  }
}
