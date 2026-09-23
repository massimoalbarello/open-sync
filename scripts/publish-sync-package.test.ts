import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const timeoutMs = 30_000;
test.each(['delayed', 'mismatch', 'denied'])(
  'publication verifies registry visibility without republishing: %s',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'open-sync-publish-'));
    try {
      await Bun.write(
        join(directory, 'package/package.json'),
        JSON.stringify({ name: '@context-use/open-sync', version: '0.3.0' }),
      );
      const artifact = join(directory, 'package.tgz');
      expect(Bun.spawnSync(['tar', '-czf', artifact, '-C', directory, 'package']).exitCode).toBe(0);
      const integrity = `sha512-${createHash('sha512')
        .update(await readFile(artifact))
        .digest('base64')}`;
      const npm = join(directory, 'bin/npm');
      const log = join(directory, 'calls');
      await Bun.write(
        npm,
        String.raw`#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require('node:fs');
const log = ${JSON.stringify(log)};
const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
const command = process.argv[2];
appendFileSync(log, command + '\n');
if (command === 'publish') process.exit(0);
if (!calls.includes('publish') || (${JSON.stringify(scenario)} === 'delayed' && calls.length === 2)) {
  console.log(JSON.stringify({ error: { code: 'E404' } }));
  process.exit(1);
}
if (${JSON.stringify(scenario)} === 'denied') {
  console.log(JSON.stringify({ error: { code: 'E403' } }));
  process.exit(1);
}
console.log(JSON.stringify(${JSON.stringify(scenario === 'mismatch' ? 'different-artifact' : integrity)}));
`,
      );
      const executableMode = 0o700;
      await chmod(npm, executableMode);
      const child = Bun.spawn(
        ['node', join(import.meta.dir, 'publish-sync-package.mjs'), artifact],
        {
          env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(await Bun.file(log).exists(), stderr).toBe(true);
      expect(
        (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .filter((call) => call === 'publish'),
      ).toHaveLength(1);
      expect(status).toBe(scenario === 'delayed' ? 0 : 1);
      if (scenario === 'delayed') {
        expect(stdout).toContain('Waiting for npm');
      } else {
        expect(stderr).toContain(scenario === 'mismatch' ? 'differs from' : 'Cannot inspect');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  timeoutMs,
);
