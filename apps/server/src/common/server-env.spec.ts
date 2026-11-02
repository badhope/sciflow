import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerEnv, serverEnvCandidates } from './server-env';

const dirs: string[] = [];

afterEach(() => {
  delete process.env.SCIFLOW_TEST_ENV_LOADER;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('server 环境变量加载', () => {
  it('从编译目录向上定位仓库内的 server 配置', () => {
    const root = mkdtempSync(join(tmpdir(), 'sciflow-env-'));
    dirs.push(root);
    const envDir = join(root, 'apps', 'server');
    const compiledDir = join(root, 'apps', 'server', 'dist', 'apps', 'server', 'src', 'common');
    mkdirSync(envDir, { recursive: true });
    mkdirSync(compiledDir, { recursive: true });
    const envFile = join(envDir, '.env');
    writeFileSync(envFile, 'SCIFLOW_TEST_ENV_LOADER=loaded\n');

    expect(serverEnvCandidates(compiledDir, compiledDir)).toContain(envFile);
    expect(loadServerEnv(compiledDir, compiledDir)).toBe(envFile);
    expect(process.env.SCIFLOW_TEST_ENV_LOADER).toBe('loaded');
  });

  it('保留已有进程环境变量，不被文件覆盖', () => {
    const root = mkdtempSync(join(tmpdir(), 'sciflow-env-'));
    dirs.push(root);
    writeFileSync(join(root, '.env'), 'SCIFLOW_TEST_ENV_LOADER=file\n');
    process.env.SCIFLOW_TEST_ENV_LOADER = 'existing';

    expect(loadServerEnv(root, root)).toBe(join(root, '.env'));
    expect(process.env.SCIFLOW_TEST_ENV_LOADER).toBe('existing');
  });
});
