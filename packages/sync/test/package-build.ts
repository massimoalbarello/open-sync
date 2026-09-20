// Copied into the isolated installed-package consumer alongside package-consumer.ts.
import { getOpenSyncBuildOptions } from '@context-use/open-sync/build';

const providers = process.argv.slice(2);
const prepared = await getOpenSyncBuildOptions({ providers });
try {
  const result = await Bun.build({
    entrypoints: ['./consumer.ts'],
    plugins: prepared.plugins,
    external: prepared.external,
    compile: { outfile: './consumer', assets: prepared.assets },
    target: 'bun',
    format: 'esm',
    bytecode: true,
    metafile: true,
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'Selected-provider compilation failed');
  }
  if (!result.metafile) {
    throw new Error('Missing build dependency graph');
  }
  const executors = Object.keys(result.metafile.inputs)
    .flatMap((path) => {
      const match = /\/providers\/([^/]+)\/executors\.js$/.exec(path);
      return match ? [match[1]!] : [];
    })
    .sort();
  if (JSON.stringify(executors) !== JSON.stringify([...new Set(providers)].sort())) {
    throw new Error(`Unexpected provider modules in executable: ${executors.join(', ')}`);
  }
} finally {
  await prepared.dispose();
}
