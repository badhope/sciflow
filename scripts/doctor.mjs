#!/usr/bin/env node
/**
 * SciFlow 环境自检 / 自愈（doctor）
 *
 * 目标：用户环境缺失或异常时，能不靠猜就知道「哪里坏了、怎么修」。
 * 只读检查 + 安全的自动修复（建目录、清锁文件），绝不改动用户数据。
 *
 * 用法：
 *   node scripts/doctor.mjs            # 检查并给出修复建议
 *   node scripts/doctor.mjs --fix      # 检查 + 自动修复可安全修复的项
 *   node scripts/doctor.mjs --json     # 机器可读输出（CI / 桌面端启动自检）
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FIX = process.argv.includes('--fix');
const JSON_OUT = process.argv.includes('--json');
const root = path.resolve(import.meta.dirname, '..');

const results = [];
const add = (id, label, status, detail, hint) => results.push({ id, label, status, detail, hint });

function envFileValues() {
  const file = path.join(root, 'apps', 'server', '.env');
  const out = {};
  if (!fs.existsSync(file)) return { file, values: out, exists: false };
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { file, values: out, exists: true };
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) add('node', 'Node.js 版本', 'ok', `v${process.versions.node}`);
  else add('node', 'Node.js 版本', 'error', `v${process.versions.node} 过低`, '升级到 Node 20+（推荐 22 LTS）：https://nodejs.org');
}

function checkDeps() {
  const missing = [];
  for (const pkg of ['apps/server/node_modules', 'apps/web/node_modules']) {
    if (!fs.existsSync(path.join(root, pkg))) missing.push(pkg);
  }
  if (missing.length === 0) add('deps', '依赖安装', 'ok', 'server / web 依赖已就绪');
  else add('deps', '依赖安装', 'error', `缺少 ${missing.join('、')}`, '在仓库根执行 pnpm install（不要加 --production）');
}

function checkDataDir() {
  const env = envFileValues();
  const dbPath = process.env.DATABASE_PATH || env.values.DATABASE_PATH || path.join(root, 'apps', 'server', 'data', 'sciflow.db');
  const dir = path.dirname(path.resolve(dbPath));
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${process.pid}.tmp`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    add('datadir', '数据目录可写', 'ok', path.resolve(dbPath));
  } catch (e) {
    add('datadir', '数据目录可写', 'error', `${dir}：${e.message}`, '换一个可写目录（DATABASE_PATH=/your/writable/path/sciflow.db），或修复目录权限');
  }
  // 崩溃残留：WAL 存在但主库缺失 / 锁文件残留
  for (const suffix of ['-wal', '-shm']) {
    const p = path.resolve(dbPath) + suffix;
    if (fs.existsSync(p) && !fs.existsSync(path.resolve(dbPath))) {
      if (FIX) {
        fs.unlinkSync(p);
        add('dblock', '数据库残留文件', 'fixed', `已清理孤儿 ${path.basename(p)}`);
      } else {
        add('dblock', '数据库残留文件', 'warn', `存在孤儿 ${path.basename(p)}（主库不存在）`, '可能是异常退出：执行 node scripts/doctor.mjs --fix 清理，或从备份恢复');
      }
      return;
    }
  }
  add('dblock', '数据库残留文件', 'ok', '无孤儿 WAL/SHM');
}

function checkPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => {
      resolve(e.code === 'EADDRINUSE' ? 'busy' : 'error');
    });
    srv.once('listening', () => srv.close(() => resolve('free')));
    srv.listen(port, '127.0.0.1');
  });
}

async function main() {
  checkNode();
  checkDeps();
  checkDataDir();

  // 端口
  const env = envFileValues();
  const port = Number(process.env.PORT || env.values.PORT || 3000);
  const portState = await checkPort(port);
  if (portState === 'free') add('port', `端口 ${port}`, 'ok', '可用');
  else if (portState === 'busy') add('port', `端口 ${port}`, 'warn', '已被占用', `SciFlow 可能已在运行（正常）；若被其他程序占用，用 PORT=3001 启动`);
  else add('port', `端口 ${port}`, 'error', '无法绑定', '检查防火墙/权限，或换端口');

  // AI 配置
  const baseUrl = process.env.AI_BASE_URL || env.values.AI_BASE_URL || '';
  const apiKey = process.env.AI_API_KEY || env.values.AI_API_KEY || '';
  if (process.env.AI_MOCK === '1') {
    add('ai', 'AI 端点', 'ok', 'AI_MOCK=1（演示/测试模式，不调用真实模型）');
  } else if (!baseUrl) {
    // 不阻断启动：界面仍可浏览/管理文献，只是 AI 功能不可用
    add('ai', 'AI 端点', 'warn', '未配置 AI_BASE_URL（AI 功能将不可用）', '复制 .env.example 为 apps/server/.env，填入 Base URL / API Key / 模型名，或在设置页「添加厂商」');
  } else if (!apiKey) {
    add('ai', 'AI 端点', 'warn', `${baseUrl}（无 API Key）`, '本地端点（Ollama/LM Studio）可留空；云端端点需要填 AI_API_KEY');
  } else {
    add('ai', 'AI 端点', 'ok', baseUrl);
  }

  // 嵌入模型 / 向量检索（v1.9：双后端，远程 /embeddings 也算「已配置」）
  const embedPath = process.env.EMBEDDING_MODEL_PATH || env.values.EMBEDDING_MODEL_PATH || '';
  const embedProvider = (process.env.EMBEDDING_PROVIDER || env.values.EMBEDDING_PROVIDER || 'auto').toLowerCase();
  const aiKey = process.env.AI_API_KEY || env.values.AI_API_KEY || '';
  if (embedPath) {
    if (fs.existsSync(embedPath)) add('embed', '嵌入模型', 'ok', `本地 GGUF：${embedPath}`);
    else add('embed', '嵌入模型', 'error', `文件不存在：${embedPath}`, '修正 EMBEDDING_MODEL_PATH，或改用 EMBEDDING_PROVIDER=api 走厂商 /embeddings');
  } else if (embedProvider === 'api' && aiKey) {
    add('embed', '嵌入模型', 'ok', '远程 /embeddings（沿用 AI_BASE_URL 与 AI_API_KEY）');
  } else if (embedProvider === 'api' && !aiKey) {
    add('embed', '嵌入模型', 'warn', 'EMBEDDING_PROVIDER=api 但未配置 AI_API_KEY', '补齐 AI_API_KEY，或改用本地 GGUF / 留空走全文检索');
  } else if (aiKey) {
    add('embed', '嵌入模型', 'ok', 'auto：无本地 GGUF 时自动走厂商 /embeddings（已检测到 AI_API_KEY）');
  } else {
    add('embed', '嵌入模型', 'warn', '未配置（自动使用全文检索）', '需要语义检索时：下载 bge-small-zh-v1.5 GGUF 并设 EMBEDDING_MODEL_PATH，或配置 AI_API_KEY + EMBEDDING_PROVIDER=api');
  }

  // sqlite-vec 原生扩展
  if (process.env.SCIFLOW_NO_VEC === '1') {
    add('vec', '向量扩展', 'warn', 'SCIFLOW_NO_VEC=1（排障模式，已禁用）', '去掉该环境变量即可恢复');
  } else {
    try {
      const { createRequire } = await import('node:module');
      const requireFromServer = createRequire(path.join(root, 'apps', 'server', 'package.json'));
      const mod = requireFromServer('sqlite-vec');
      const p = mod.getLoadablePath();
      add(fs.existsSync(p) ? 'vec' : 'vec', '向量扩展', fs.existsSync(p) ? 'ok' : 'warn', p, fs.existsSync(p) ? '' : '重装依赖：pnpm rebuild sqlite-vec');
    } catch (e) {
      add('vec', '向量扩展', 'warn', e.message, '向量检索将降级为全文检索；如需启用请重装依赖');
    }
  }

  // Python（实验沙箱）
  const pyCandidates = [['python3', []], ['py', ['-3']], ['python', []]];
  let pyCmd = '';
  let pyOut = '';
  for (const [cmd, args] of pyCandidates) {
    const r = spawnSync(cmd, [...args, '--version'], { encoding: 'utf-8' });
    if (!r.error && r.status === 0) {
      pyCmd = [cmd, ...args].join(' ');
      pyOut = (r.stdout || r.stderr).trim();
      break;
    }
  }
  add('python', 'Python（实验沙箱）', pyCmd ? 'ok' : 'warn', pyCmd ? `${pyOut}（${pyCmd}）` : '未找到 Python 3', pyCmd ? '' : '实验功能将不可用；安装 Python 3 后重开终端');

  // 构建产物
  const dist = path.join(root, 'apps', 'server', 'dist', 'apps', 'server', 'src', 'main.js');
  add('build', '后端构建产物', fs.existsSync(dist) ? 'ok' : 'warn', fs.existsSync(dist) ? 'dist/main.js 存在' : '尚未构建', fs.existsSync(dist) ? '' : '执行 pnpm build（或 pnpm --filter @sciflow/server build）');

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: results.every((r) => r.status !== 'error'), results }, null, 2));
  } else {
    const icon = { ok: '✓', warn: '!', error: '✗', fixed: '✔' };
    console.log('\nSciFlow 环境自检\n' + '─'.repeat(56));
    for (const r of results) {
      console.log(`${icon[r.status]} ${r.label.padEnd(18)} ${r.detail}`);
      if (r.hint && r.status !== 'ok' && r.status !== 'fixed') console.log(`  → ${r.hint}`);
    }
    const errs = results.filter((r) => r.status === 'error').length;
    const warns = results.filter((r) => r.status === 'warn').length;
    console.log('─'.repeat(56));
    console.log(errs ? `发现 ${errs} 个阻断问题，${warns} 个警告` : warns ? `环境可用（${warns} 个非阻断警告）` : '环境完全就绪');
    if (!FIX && results.some((r) => r.status === 'warn' || r.status === 'error')) {
      console.log('可安全自动修复的项：node scripts/doctor.mjs --fix');
    }
  }
  process.exit(results.some((r) => r.status === 'error') ? 1 : 0);
}

main();
