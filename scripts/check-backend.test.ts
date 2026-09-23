import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CHECK_TIMEOUT = 30_000;

test(
  'architecture check enforces private exports and requires every source root',
  async () => {
    const root = join(import.meta.dir, '..');
    const directory = await mkdtemp(join(tmpdir(), 'open-sync-architecture-'));
    const frontend = 'apps/web/frontend/src/main.tsx';
    const integration = 'examples/integrations/src/main.ts';
    const check = () =>
      spawnSync('node', ['scripts/check-backend.mjs'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: CHECK_TIMEOUT,
      });
    try {
      for (const file of [
        'scripts/check-backend.mjs',
        'apps/web/backend/dependency-cruiser.config.mjs',
        'packages/sync/package.json',
      ]) {
        await mkdir(dirname(join(directory, file)), { recursive: true });
        await copyFile(join(root, file), join(directory, file));
      }
      await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
      for (const file of [
        'apps/web/backend/src/main.ts',
        frontend,
        'packages/sync/src/models/record.ts',
        'packages/sync/src/api.ts',
        integration,
      ]) {
        await mkdir(dirname(join(directory, file)), { recursive: true });
        await writeFile(join(directory, file), 'export interface Contract {}\n');
      }
      await writeFile(
        join(directory, frontend),
        "import type { Contract } from '../../../../packages/sync/src/models/record.ts';\n",
      );
      expect(check().status).toBe(0);

      await writeFile(
        join(directory, frontend),
        "import type { Contract } from '../../../../packages/sync/src/api.ts';\n",
      );
      const forbidden = check();
      expect(forbidden.status).toBe(1);
      expect(forbidden.stdout).toContain('hosts-consume-public-engine-exports');

      await writeFile(join(directory, frontend), 'export {};\n');
      await rm(join(directory, integration));
      const empty = check();
      expect(empty.status).toBe(1);
      expect(empty.stderr).toContain('scanned no TypeScript modules in examples/integrations/src');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  CHECK_TIMEOUT,
);
