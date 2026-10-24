/**
 * 应用版本单一来源（v1.0.1 收敛）。
 *
 * 历史问题：MCP serverInfo 写死 '0.3.0'、外部 MCP Client 写死 '0.4.0'、
 * CLI 写死 '1.0.0' —— 三处各漂各的，包版本升到 1.x 后对外自报仍是 0.3.0。
 *
 * 实现说明：不用 `import pkg from '../../package.json'`——tsc 编译后模块位置变化，
 * dist 下相对路径会指向不存在的文件（构建期能过、运行期 ERR_MODULE_NOT_FOUND）。
 * 改为运行时向上查找 package.json，源码运行与 dist 运行都能命中。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function readVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: string; version?: string };
        // 只认 sciflow 根包或 @sciflow/server 包，避免误读其它依赖的 package.json
        if (pkg.name === 'sciflow' || pkg.name === '@sciflow/server') return String(pkg.version || '0.0.0');
      } catch {
        /* 继续向上找 */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.env.npm_package_version || '0.0.0';
}

export const APP_VERSION: string = readVersion();
