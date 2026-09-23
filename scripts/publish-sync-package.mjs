import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const artifact = resolve(process.argv[2]);
const metadata = JSON.parse(
  execFileSync('tar', ['-xOf', artifact, 'package/package.json'], { encoding: 'utf8' }),
);
assert.equal(metadata.name, '@context-use/open-sync');
const spec = `${metadata.name}@${metadata.version}`;
const integrity = `sha512-${createHash('sha512').update(readFileSync(artifact)).digest('base64')}`;
const existing = spawnSync('npm', ['view', spec, 'dist.integrity', '--json'], { encoding: 'utf8' });
if (existing.error) {
  throw existing.error;
}
const result = JSON.parse(existing.stdout);
if (existing.status === 0) {
  assert.equal(
    result,
    integrity,
    `${spec} already exists with different contents. Bump the package version.`,
  );
  console.log(`${spec} is already published with these contents.`);
} else {
  assert.equal(result.error?.code, 'E404', `Cannot inspect ${spec}: ${existing.stderr}`);
  execFileSync('npm', ['publish', artifact, '--access', 'public', '--ignore-scripts'], {
    stdio: 'inherit',
  });
  const propagationTimeoutMs = 600_000;
  const pollIntervalMs = 15_000;
  const deadline = Date.now() + propagationTimeoutMs;
  for (;;) {
    const visible = spawnSync(
      'npm',
      ['view', spec, 'dist.integrity', '--json', '--prefer-online'],
      { encoding: 'utf8' },
    );
    if (visible.error) {
      throw visible.error;
    }
    const published = JSON.parse(visible.stdout);
    if (visible.status === 0) {
      assert.equal(published, integrity, 'Published package differs from the verified artifact.');
      break;
    }
    assert.equal(published.error?.code, 'E404', `Cannot inspect ${spec}: ${visible.stderr}`);
    assert.ok(
      Date.now() < deadline,
      `${spec} is still unavailable after npm accepted publication.`,
    );
    console.log(`Waiting for npm to make ${spec} available…`);
    await setTimeout(pollIntervalMs);
  }
}
