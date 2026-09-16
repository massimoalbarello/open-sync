import { deployToNibrun } from '@repo/build-tools/deploy-nibrun';

await deployToNibrun({
  directory: new URL('..', import.meta.url).pathname,
  binary: 'dist/app',
  task: 'build',
});
