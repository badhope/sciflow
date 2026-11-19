#!/usr/bin/env node
/**
 * 首屏 JS 预算守卫。
 *
 * 背景：重依赖（elk 1.5MB / CodeMirror 610KB / ForceGraph 441KB）必须保持按页面懒加载，
 * 但不能靠"构建 warning 不超过 900KB"这种全局阈值来判断——那会把首屏体积一起放过去。
 *
 * 规则：
 *  1. 只统计 dist/index.html 直接加载的 JS（script src + modulepreload），不统计懒加载 chunk；
 *  2. 首屏总量默认 450KB（未压缩），可用 CHUNK_BUDGET_KB 覆盖；
 *  3. 输出最大初始块与最大懒加载块，便于定位回归。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const htmlPath = join(dist, 'index.html');
const budgetKb = Number(process.env.CHUNK_BUDGET_KB || 450);

let html;
try {
  html = readFileSync(htmlPath, 'utf8');
} catch {
  console.error(`[chunk-budget] 找不到 ${htmlPath}，先运行 pnpm --filter @sciflow/web build`);
  process.exit(1);
}

const initialAssets = new Set();
for (const match of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) initialAssets.add(match[1]);
for (const match of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)) initialAssets.add(match[1]);
for (const match of html.matchAll(/<link[^>]+href="([^"]+\.js)"[^>]+rel="modulepreload"/g)) initialAssets.add(match[1]);

const assetsDir = join(dist, 'assets');
const allAssets = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
const sizeOf = (name) => {
  const file = name.startsWith('/') ? join(dist, name) : join(assetsDir, name.split('/').pop());
  return statSync(file).size;
};

const initial = [...initialAssets].map((name) => ({ name: name.split('/').pop(), bytes: sizeOf(name) }));
const initialBytes = initial.reduce((sum, a) => sum + a.bytes, 0);
const lazy = allAssets
  .filter((f) => !initial.some((a) => a.name === f))
  .map((f) => ({ name: f, bytes: statSync(join(assetsDir, f)).size }))
  .sort((a, b) => b.bytes - a.bytes);
const biggestInitial = [...initial].sort((a, b) => b.bytes - a.bytes)[0];
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

console.log(`[chunk-budget] 首屏 JS：${initial.length} 个文件 / ${kb(initialBytes)}，预算 ${budgetKb} KB`);
for (const a of initial.sort((a, b) => b.bytes - a.bytes)) console.log(`  - ${a.name}: ${kb(a.bytes)}`);
if (lazy[0]) console.log(`[chunk-budget] 最大懒加载块：${lazy[0].name} ${kb(lazy[0].bytes)}（首屏不加载）`);

if (initialBytes > budgetKb * 1024) {
  console.error(`[chunk-budget] 超预算 ${kb(initialBytes - budgetKb * 1024)}：把新依赖改为页面内动态 import，或把通用库拆到懒加载 chunk。`);
  process.exit(1);
}
if (biggestInitial && biggestInitial.bytes > 250 * 1024) {
  console.error(`[chunk-budget] 单个首屏块 ${biggestInitial.name} 超过 250 KB，检查是否把重库打进了主包。`);
  process.exit(1);
}
console.log('[chunk-budget] 通过');
