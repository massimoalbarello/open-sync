import { join } from 'node:path';
import { getOpenSyncBuildOptions, providersFromDefinitions } from '@context-use/open-sync/build';
import { syncDefinitions } from '../backend/src/sync-definitions';

const target = process.env.BUILD_TARGET;
if (target && target !== 'bun-linux-x64') {
  throw new Error('BUILD_TARGET must be bun-linux-x64 or unset for a host build.');
}
const syncBuild = await getOpenSyncBuildOptions({
  providers: providersFromDefinitions(syncDefinitions),
});
try {
  const result = await Bun.build({
    plugins: syncBuild.plugins,
    entrypoints: [join(import.meta.dir, '../backend/src/main.ts')],
    compile: {
      outfile: join(import.meta.dir, '../dist/app'),
      execArgv: ['--smol'],
      ...(target ? { target: 'bun-linux-x64' as const } : {}),
      assets: [
        join(import.meta.dir, '../dist/public'),
        join(import.meta.dir, '../backend/src/db/migrations'),
        ...syncBuild.assets,
      ],
    },
    splitting: true,
    external: syncBuild.external,
    format: 'esm',
    naming: { asset: '[dir]/[name].[ext]' },
    define: {
      PUBLIC_FRONTEND_DIR_NAME: JSON.stringify('public'),
      DB_MIGRATIONS_DIR_NAME: JSON.stringify('migrations'),
    },
    minify: { whitespace: true, syntax: true },
    target: 'bun',
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'Application compilation failed');
  }
} finally {
  await syncBuild.dispose();
}
