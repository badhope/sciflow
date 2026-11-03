#!/usr/bin/env node
/**
 * SciFlow 桌面端 · 打包资源准备
 *
 * 产出到 apps/desktop/resources/（electron-builder extraResources 引用）：
 *   resources/bundle/server/  自包含后端 bundle（pnpm deploy 产出：dist + 生产 node_modules，原生模块可用）
 *   resources/web/            前端静态产物（apps/web/dist）
 *
 * 为什么多一层 resources/bundle/：electron-builder 的 extraResources 过滤器硬编码
 * `if (relative === "node_modules") return false`（app-builder-lib/out/util/filter.js），
 * 会把 from 目录根级的 node_modules 静默丢弃 —— 实测导致 0.4.1 安装包缺少全部生产依赖（1.42GB→100MB）。
 * 放进二级目录后相对路径不再是 "node_modules"，复制正常。
 *
 * 前置：已执行 pnpm --filter @sciflow/server build 与 pnpm --filter @sciflow/web build
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // apps/desktop/scripts
const desktopDir = path.resolve(here, '..'); // apps/desktop
const repoRoot = path.resolve(desktopDir, '..', '..'); // 仓库根
const resourcesDir = path.join(desktopDir, 'resources');
const bundleRoot = path.join(resourcesDir, 'bundle');
const serverBundleDir = path.join(bundleRoot, 'server');
const webDir = path.join(resourcesDir, 'web');

const step = (msg) => console.log(`\x1b[36m[prepare]\x1b[0m ${msg}`);
const ok = (msg) => console.log(`\x1b[32m[prepare]\x1b[0m ${msg}`);

/** 轻量目录体积（用于裁剪前后对比；失败返回 0） */
function dirSizeLite(d) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(d, { withFileTypes: true, recursive: true })) {
      if (f.isFile()) {
        try {
          total += fs.statSync(path.join(f.parentPath ?? f.path, f.name)).size;
        } catch {
          /* race */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}

/**
 * 校验前端产物是否可用于 file:// 加载。
 * 绝对路径（/assets/...）在 Electron 里会解析成 file:///C:/assets/... → 全部 404 → 白屏。
 * 这是 0.7.0/0.8.0 桌面端「打开什么都没有」的根因，必须在此拦截而不是等用户看到白屏。
 */
function assertWebRelative() {
  const indexHtml = path.join(repoRoot, 'apps', 'web', 'dist-desktop', 'index.html');
  const html = fs.readFileSync(indexHtml, 'utf-8');
  const bad = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
  if (bad.length) {
    console.error('[prepare] 前端产物使用了绝对路径，Electron 用 file:// 加载会白屏：');
    for (const b of bad.slice(0, 5)) console.error('  ' + b);
    console.error('请用相对 base 构建：pnpm --filter @sciflow/web exec vite build --base=./');
    process.exit(1);
  }
}

function assertBuilt() {
  // tsc(rootDir=仓库根) 产物布局：dist/apps/server/src/main.js
  const serverDist = path.join(repoRoot, 'apps', 'server', 'dist', 'apps', 'server', 'src', 'main.js');
  const WEB_DESKTOP_DIR = path.join(repoRoot, 'apps', 'web', 'dist-desktop');
  const webDist = path.join(WEB_DESKTOP_DIR, 'index.html');
  if (!fs.existsSync(serverDist)) {
    console.error('\x1b[31m[prepare]\x1b[0m 缺少后端构建产物，请先执行：pnpm --filter @sciflow/server build');
    process.exit(1);
  }
  if (!fs.existsSync(webDist)) {
    console.error('\x1b[31m[prepare]\x1b[0m 缺少前端构建产物，请先执行：pnpm --filter @sciflow/web build');
    process.exit(1);
  }
}

/** 递归删除目录（仅限本次生成的 resources 子目录，路径受控） */
function cleanDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  step('校验构建产物…');
  assertBuilt();
  assertWebRelative();
  ok('后端 dist 与前端 dist 均就绪（前端为相对路径，可用于 file:// 加载）');

  // ---------- 1. server bundle：pnpm deploy（pnpm 官方部署机制） ----------
  step('生成自包含 server bundle（pnpm deploy --prod）…');
  cleanDir(bundleRoot);
  cleanDir(serverBundleDir);
  execSync(`pnpm --filter @sciflow/server deploy --legacy --prod "${serverBundleDir}"`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  // deploy 不复制 .env（也不应该：密钥不入包），写一个空模板提示运行时经设置页/环境变量配置
  const bundleEnv = path.join(serverBundleDir, '.env.example');
  fs.writeFileSync(bundleEnv, '# 桌面端通常无需此文件：AI Key 在应用「设置」页配置（存本地数据库）。\n');
  ok(`server bundle 就绪：${serverBundleDir}`);

  // ---------- 1.5 Electron ABI：为内嵌 Node 重编原生模块 ----------
  // 背景：server bundle 的 better-sqlite3 在开发机按 Node ABI 编译；Electron 内嵌 Node 的 ABI
  // 与系统 Node 不同（系统 Node 24 ABI=137 / Electron 41 ABI=145），不重编会在运行时报 ERR_DLOPEN_FAILED。
  // 本步骤读取 desktop 的 electron 版本，按 Electron 目标重编（幂等：ABI 戳一致则跳过）。
  step('为 Electron ABI 重编原生模块（better-sqlite3）…');
  const electronPkgPath = path.join(desktopDir, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(electronPkgPath)) {
    console.error('\x1b[31m[prepare]\x1b[0m 未找到 electron（请先 pnpm install）');
    process.exit(1);
  }
  const electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')).version;

  /** 在 server bundle 内定位 better-sqlite3 模块目录（pnpm .pnpm 布局优先，回退深搜 binding.gyp） */
  function findBetterSqlite3(rootDir) {
    const pnpmDir = path.join(rootDir, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      const hit = fs.readdirSync(pnpmDir).find((d) => d.startsWith('better-sqlite3@'));
      if (hit) {
        const dir = path.join(pnpmDir, hit, 'node_modules', 'better-sqlite3');
        if (fs.existsSync(path.join(dir, 'binding.gyp'))) return dir;
      }
    }
    const stack = [rootDir];
    while (stack.length) {
      const d = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(d, e.name);
        if (e.name === 'better-sqlite3' && fs.existsSync(path.join(full, 'binding.gyp'))) return full;
        if (e.name === '.pnpm' || e.name === 'node_modules' || e.name === 'build' || e.name === 'deps' || e.name === 'src' || e.name === 'lib') stack.push(full);
      }
    }
    return null;
  }

  const sqliteDir = findBetterSqlite3(serverBundleDir);
  if (!sqliteDir) {
    console.warn('\x1b[33m[prepare]\x1b[0m 未在 bundle 内找到 better-sqlite3（跳过 ABI 重编）');
  } else {
    const abiStamp = path.join(sqliteDir, '.electron-abi');
    const binary = path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
    const upToDate = fs.existsSync(binary) && fs.existsSync(abiStamp) && fs.readFileSync(abiStamp, 'utf8').trim() === electronVersion;
    if (upToDate) {
      ok(`better-sqlite3 已是 Electron ${electronVersion} ABI（跳过）`);
    } else {
      // 2026-11 改进：三级获取策略，全部免工具链——
      //   ① GitHub 官方预编译包（prebuild-install 默认）
      //   ② npmmirror 二进制镜像（--download 直链；GitHub 被墙/抖动时的可用源）
      //   ③ node-gyp 源码重编（需要 VS C++ 工具链；CI runner 自带，本机通常没有）
      // ABI 号用 node-abi 从 electronVersion 精确换算（禁止手猜映射表）。
      let viaPrebuild = false;
      const pkgJson = JSON.parse(fs.readFileSync(path.join(sqliteDir, 'package.json'), 'utf8'));
      const pkgVer = pkgJson.version;
      let abi = '';
      try {
        const { createRequire } = await import('node:module');
        const desktopRequire = createRequire(path.join(root, 'apps', 'desktop', 'package.json'));
        const nodeAbi = desktopRequire('node-abi');
        abi = nodeAbi.getAbi(electronVersion, 'electron');
      } catch {
        console.warn('\x1b[33m[prepare]\x1b[0m node-abi 不可用，跳过镜像直链（仅影响②）');
      }
      const platformTag = `${process.platform}-${process.arch}`;
      const mirrorUrl = abi
        ? `https://registry.npmmirror.com/-/binary/better-sqlite3/v${pkgVer}/better-sqlite3-v${pkgVer}-electron-v${abi}-${platformTag}.tar.gz`
        : '';

      for (const attempt of [
        { label: `GitHub 预编译包 (electron v${electronVersion})`, cmd: `npx --yes prebuild-install -r electron -t ${electronVersion} --verbose` },
        ...(mirrorUrl ? [{ label: `npmmirror 镜像 (ABI ${abi})`, cmd: `npx --yes prebuild-install -r electron -t ${electronVersion} --download "${mirrorUrl}"` }] : []),
      ]) {
        try {
          console.log(`\x1b[36m[prepare]\x1b[0m 尝试下载 ${attempt.label} …`);
          execSync(attempt.cmd, {
            cwd: sqliteDir, stdio: 'inherit', shell: true, env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
          });
          viaPrebuild = fs.existsSync(binary);
          if (viaPrebuild) {
            ok(`better-sqlite3 预编译包就绪（${attempt.label}，免工具链）`);
            break;
          }
        } catch {
          console.warn(`\x1b[33m[prepare]\x1b[0m ${attempt.label} 不可用`);
        }
      }
      if (!viaPrebuild) {
        console.warn('\x1b[33m[prepare]\x1b[0m 预编译两条路都不可用，回退 node-gyp 源码重编…');
        execSync(
          `npx --yes node-gyp rebuild --release --target=${electronVersion} --dist-url=https://electronjs.org/headers`,
          { cwd: sqliteDir, stdio: 'inherit', shell: true, env: { ...process.env, NODE_OPTIONS: '--use-system-ca' } },
        );
      }
      fs.writeFileSync(abiStamp, electronVersion);
      ok(`better-sqlite3 已按 Electron ${electronVersion} ABI 就绪`);
    }
  }

  // ---------- 1.8 裁剪可选原生加速包（体积红线） ----------
  // node-llama-cpp 的可选依赖会按平台把 CUDA / Vulkan / CUDA-ext 全量装进来
  // （实测 @node-llama-cpp+win-x64-cuda-ext 351MB + cuda 168MB + vulkan 71MB）。
  // 桌面端嵌入模型使用 CPU 推理即可：只保留 win-x64（CPU）与通用包，其余在打包产物中删除。
  // 不删源码仓库的 node_modules，只删 resources/ 下的副本；用户仍可自行放 GGUF 模型。
  step('裁剪可选 GPU 加速包（保留 CPU 推理）…');
  const pnpmStore = path.join(serverBundleDir, 'node_modules', '.pnpm');
  const prunePatterns = [
    /^@node-llama-cpp\+(win|linux|mac).*-cuda/,
    /^@node-llama-cpp\+(win|linux|mac).*-vulkan/,
    /^@node-llama-cpp\+(win|linux|mac).*-metal/,
  ];
  let pruned = 0;
  let freed = 0;
  if (fs.existsSync(pnpmStore)) {
    for (const entry of fs.readdirSync(pnpmStore)) {
      if (!prunePatterns.some((re) => re.test(entry))) continue;
      const full = path.join(pnpmStore, entry);
      const size = dirSizeLite(full);
      fs.rmSync(full, { recursive: true, force: true });
      pruned += 1;
      freed += size;
    }
  }
  ok(`已裁剪 ${pruned} 个可选 GPU 包，释放 ${(freed / 1024 / 1024).toFixed(0)} MB`);

  // 关键：pnpm 在 .pnpm/node_modules/<pkg> 下留了指向被删目录的符号链接。
  // 7-Zip 打包时会因悬空链接报 `WARNING: 系统找不到指定的路径` 并以 exit 1 失败
  // （实测 NSIS 阶段 7za process failed 1）。这里清理所有指向不存在目标的链接。
  // 2026-11 修复：Windows junction 在 readdir Dirent 上 isSymbolicLink() 返回 false，
  // 旧实现把它当目录递归、readdir(ENOENT) 异常把整个清扫吞掉——改为 lstat 逐项判定 +
  // 单项异常不中断；并无条件剔除 .pnpm/node_modules 下的 @sciflow/* 工作区自链接
  // （pnpm deploy 的产物自带 dist，这些指向仓库源码的相对链接在安装包里永远是悬空的）。
  let dangling = 0;
  const sweepLinks = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录本身不可读（可能就是悬空 junction），由调用方的 lstat 分支处理
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        fs.rmSync(full, { force: true }); // lstat 都失败的死条目，直接删
        dangling += 1;
        continue;
      }
      if (st.isSymbolicLink()) {
        try {
          fs.statSync(full); // 跟随，目标不存在会抛
        } catch {
          fs.rmSync(full, { force: true });
          dangling += 1;
        }
        continue;
      }
      if (st.isDirectory()) sweepLinks(full);
    }
  };
  try {
    sweepLinks(path.join(serverBundleDir, 'node_modules'));
    // .pnpm 内部还有一层 node_modules 链接目录（前面遍历已覆盖），再兜底一次
    const nested = path.join(pnpmStore, 'node_modules');
    if (fs.existsSync(nested)) sweepLinks(nested);
    // 工作区自链接无条件剔除：@sciflow/* 指向仓库源码的相对 junction，安装包内必然悬空
    const wsSelfLinks = path.join(pnpmStore, 'node_modules', '@sciflow');
    if (fs.existsSync(wsSelfLinks)) {
      fs.rmSync(wsSelfLinks, { recursive: true, force: true });
      dangling += 1;
    }
  } catch (e) {
    console.warn(`\x1b[33m[prepare]\x1b[0m 悬空链接清扫异常（继续）：${String(e?.message || e).slice(0, 120)}`);
  }
  ok(`已清理 ${dangling} 个悬空符号链接`);

  // 同时去掉 node-llama-cpp 的 cuda/vulkan 运行时二进制（如果在通用包内）
  const llamaDirs = fs.existsSync(pnpmStore)
    ? fs.readdirSync(pnpmStore).filter((d) => d.startsWith('node-llama-cpp@'))
    : [];
  for (const d of llamaDirs) {
    const bins = path.join(pnpmStore, d, 'node_modules', 'node-llama-cpp', 'llama');
    for (const sub of ['cuda', 'vulkan']) {
      const target = path.join(bins, sub);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        pruned += 1;
      }
    }
  }

  // ---------- 1.9 剔除不该进安装包的目录 ----------
  // pnpm deploy 会把 server 包整目录复制过来，实测带进：data/（本机测试库 60MB）、src/（TS 源码）、
  // *.spec.ts（测试）、vitest/eslint 配置。安装包只应包含 dist + 生产依赖。
  step('剔除源码与本地测试库…');
  const stripTargets = ['data', 'src', 'scripts', 'test', 'tests', 'coverage', '.turbo'];
  let stripped = 0;
  let strippedBytes = 0;
  for (const name of stripTargets) {
    const target = path.join(serverBundleDir, name);
    if (!fs.existsSync(target)) continue;
    strippedBytes += dirSizeLite(target);
    fs.rmSync(target, { recursive: true, force: true });
    stripped += 1;
  }
  // 递归删除 spec/test 与 sourcemap（安装包不需要，且会泄漏测试内部结构）
  const walkRemove = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.pnpm') continue;
        walkRemove(full);
      } else if (/\.(spec|test)\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) {
        strippedBytes += fs.statSync(full).size;
        fs.rmSync(full, { force: true });
        stripped += 1;
      }
    }
  };
  try {
    walkRemove(serverBundleDir);
  } catch {
    /* ignore */
  }
  ok(`已剔除 ${stripped} 项（源码/测试/本地库），释放 ${(strippedBytes / 1024 / 1024).toFixed(0)} MB`);

  // ---------- 2. web 静态产物 ----------
  step('复制前端产物…');
  cleanDir(webDir);
  await fs.promises.cp(path.join(repoRoot, 'apps', 'web', 'dist-desktop'), webDir, { recursive: true });
  ok(`web 资源就绪：${webDir}`);

  // ---------- 3. 体积报告 ----------
  const dirSize = (d) => {
    let total = 0;
    if (!fs.existsSync(d)) return 0;
    for (const f of fs.readdirSync(d, { withFileTypes: true, recursive: true })) {
      if (f.isFile()) {
        try {
          total += fs.statSync(path.join(f.parentPath ?? f.path, f.name)).size;
        } catch {
          /* race */
        }
      }
    }
    return total;
  };
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  step(`体积：server=${mb(dirSize(serverBundleDir))} · web=${mb(dirSize(webDir))}`);
  ok('资源准备完成');
}

main().catch((e) => {
  console.error('\x1b[31m[prepare]\x1b[0m 失败:', e);
  process.exit(1);
});
