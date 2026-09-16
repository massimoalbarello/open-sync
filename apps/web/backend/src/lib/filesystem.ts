import { mkdirSync } from 'node:fs';
export function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}
