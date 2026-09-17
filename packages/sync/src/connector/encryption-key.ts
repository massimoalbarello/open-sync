import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Independent from login secrets; retain this key alongside the opaque Connector data. */
export async function loadProviderKey(dataFolder: string): Promise<string> {
  await mkdir(dataFolder, { recursive: true });
  const path = join(dataFolder, '.connector-key');
  const bytes = 32;
  const mode = 0o600;
  try {
    await writeFile(path, randomBytes(bytes).toString('hex'), { flag: 'wx', mode });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }
  const value = await readFile(path, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('Invalid provider encryption key.');
  }
  return value;
}
