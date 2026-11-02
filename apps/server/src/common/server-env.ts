import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

export function serverEnvCandidates(baseDir = __dirname, cwd = process.cwd()): string[] {
  const upward = (name: string) => Array.from({ length: 6 }, (_, i) => resolve(baseDir, ...Array(i).fill('..'), name));
  return [...new Set([
    resolve(cwd, 'apps', 'server', '.env'),
    resolve(cwd, '.env'),
    ...upward('apps/server/.env'),
    ...upward('.env'),
  ])];
}

export function loadServerEnv(baseDir = __dirname, cwd = process.cwd()): string | undefined {
  for (const path of serverEnvCandidates(baseDir, cwd)) {
    if (!existsSync(path)) continue;
    loadEnv({ path });
    return path;
  }
  return undefined;
}
