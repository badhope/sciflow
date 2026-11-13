#!/usr/bin/env node
/**
 * 复现 harness（阶段 3 最小版）。
 *
 * 设计目标：
 *  - 锁 commit、Python 版本与依赖 freeze，产出可审计 manifest；
 *  - 每次运行在独立目录，不污染仓库；
 *  - 默认跑两遍并比较产物 SHA-256，验证确定性；
 *  - 只使用 Node 内置模块，不引入依赖。
 *
 * 用法：
 *   node reproduction/run-case.mjs --case reproduction/cases/plass-stone-1983.json \
 *     --workdir D:\sciflow-research\data\reproduction-runs \
 *     --uv "C:\Program Files\Python315\Scripts\uv.exe"
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const casePath = path.resolve(arg('case', ''));
if (!casePath || !fs.existsSync(casePath)) {
  console.error('缺少或找不到 --case <case.json>');
  process.exit(2);
}
const caseData = JSON.parse(fs.readFileSync(casePath, 'utf8'));
const runsRequested = Math.max(1, Math.min(3, Number(arg('runs', '2')) || 2));
const projectRoot = path.resolve(path.dirname(casePath), '../..');
const workRoot = path.resolve(arg('workdir', path.join(projectRoot, '..', 'data', 'reproduction-runs')));
const uvBin = arg('uv', process.env.UV_BIN || 'uv');
const repoCache = arg('repo-cache', '');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(workRoot, `${caseData.id}-${stamp}`);
const repoDir = path.join(runDir, 'repo');
const venvDir = path.join(runDir, 'venv');
const artifactsRoot = path.join(runDir, 'artifacts');
const manifestPath = path.join(runDir, 'manifest.json');

fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(artifactsRoot, { recursive: true });

const envBase = {
  ...process.env,
  HOME: process.env.HOME || path.join(projectRoot, '..', 'home'),
  TMP: process.env.TMP || path.join(projectRoot, '..', 'tmp'),
  TEMP: process.env.TEMP || path.join(projectRoot, '..', 'tmp'),
  TMPDIR: process.env.TMPDIR || path.join(projectRoot, '..', 'tmp'),
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  MPLBACKEND: 'Agg',
  UV_PYTHON_INSTALL_DIR: path.join(projectRoot, '..', 'tools', 'uv-python'),
  UV_CACHE_DIR: path.join(projectRoot, '..', 'cache', 'uv'),
  UV_LINK_MODE: 'copy',
  GIT_TERMINAL_PROMPT: '0',
};

function run(cmd, cmdArgs, opts = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd || repoDir,
    env: { ...envBase, ...(opts.env || {}) },
    encoding: 'utf8',
    timeout: opts.timeoutMs || 600_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    cmd: [cmd, ...cmdArgs].join(' '),
    status: r.status,
    signal: r.signal,
    durationMs: Date.now() - started,
    stdout: (r.stdout || '').slice(0, 20_000),
    stderr: (r.stderr || '').slice(0, 20_000),
    error: r.error ? String(r.error.message || r.error) : undefined,
  };
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function getPath(obj, dotted) {
  return String(dotted || '').split('.').filter(Boolean).reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** 从产物提取指标；支持 JSON 字段或纯文本数字，按 expected/tolerance 判定 */
function readMetric(metric) {
  const file = path.join(repoDir, metric.artifact);
  if (!fs.existsSync(file)) {
    return { name: metric.name, found: false, expected: metric.expected ?? null, pass: metric.expected == null ? null : false };
  }
  let value;
  try {
    if (metric.jsonPath) {
      value = getPath(JSON.parse(fs.readFileSync(file, 'utf8')), metric.jsonPath);
    } else {
      value = Number(fs.readFileSync(file, 'utf8').trim());
    }
  } catch (e) {
    return { name: metric.name, found: true, error: String(e.message || e), expected: metric.expected ?? null, pass: metric.expected == null ? null : false };
  }
  const numeric = Number(value);
  const expected = metric.expected == null ? null : Number(metric.expected);
  const tolerance = Number(metric.tolerance ?? 0);
  const pass = expected == null || (Number.isFinite(numeric) && Math.abs(numeric - expected) <= tolerance);
  return {
    name: metric.name,
    artifact: metric.artifact,
    jsonPath: metric.jsonPath || null,
    value: Number.isFinite(numeric) ? numeric : value,
    expected,
    tolerance,
    pass,
  };
}

function copyArtifact(rel, destDir) {
  const src = path.join(repoDir, rel);
  if (!fs.existsSync(src)) return { path: rel, exists: false };
  const dest = path.join(destDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const st = fs.statSync(dest);
  return { path: rel, exists: true, bytes: st.size, sha256: sha256(dest) };
}

function fail(message) {
  console.error(`\n[复现失败] ${message}`);
  process.exit(1);
}

const manifest = {
  case: caseData,
  runDir,
  host: {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
  },
  startedAt: new Date().toISOString(),
  runs: [],
  determinism: null,
  status: 'running',
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`[复现] case=${caseData.id}`);
console.log(`[复现] runDir=${runDir}`);

// 1) 克隆 + 锁 commit（优先本地缓存，避免弱网/离线阻断）
const cloneSource = repoCache ? path.resolve(repoCache) : caseData.reproduction.repo;
if (repoCache && !fs.existsSync(cloneSource)) fail(`repo-cache 不存在：${cloneSource}`);
const clone = run('git', ['-c', 'credential.helper=', 'clone', '--quiet', cloneSource, repoDir], {
  cwd: runDir,
});
if (clone.status !== 0) fail(`git clone 失败：${clone.stderr || clone.error || ''}`);
const checkout = run('git', ['-c', 'credential.helper=', 'checkout', '--quiet', caseData.reproduction.commit]);
if (checkout.status !== 0) fail(`git checkout ${caseData.reproduction.commit} 失败：${checkout.stderr || checkout.error || ''}`);
const head = run('git', ['rev-parse', 'HEAD']);
if (head.stdout.trim() !== caseData.reproduction.commit) {
  fail(`commit 不匹配：期望 ${caseData.reproduction.commit}，实际 ${head.stdout.trim()}`);
}
manifest.repo = {
  url: caseData.reproduction.repo,
  commit: head.stdout.trim(),
  license: caseData.reproduction.license,
  cloneSource,
};
console.log(`[复现] commit=${manifest.repo.commit}${repoCache ? '（本地缓存）' : ''}`);

// 2) 隔离 Python 环境（uv 管理；下载/缓存都在项目目录）
const venv = run(uvBin, ['venv', '--managed-python', '--python', caseData.python, '--no-project', venvDir], {
  cwd: runDir,
});
if (venv.status !== 0) fail(`uv venv 失败：${venv.stderr || venv.error || ''}`);
const py = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');
if (!fs.existsSync(py)) fail(`venv python 不存在：${py}`);

const pyVersion = run(py, ['-c', 'import sys; print(sys.version)'], { cwd: runDir });
if (pyVersion.status !== 0) fail(`Python 启动失败：${pyVersion.stderr || pyVersion.error || ''}`);
manifest.python = { version: pyVersion.stdout.trim(), executable: py };

const lockPath = caseData.lockFile ? path.resolve(path.dirname(casePath), caseData.lockFile) : null;
if (lockPath && !fs.existsSync(lockPath)) fail(`lockFile 不存在：${lockPath}`);
const installArgs = lockPath
  ? ['pip', 'install', '--python', py, '-r', lockPath]
  : ['pip', 'install', '--python', py, ...caseData.dependencies];
const install = run(uvBin, installArgs, { cwd: runDir });
if (install.status !== 0) fail(`依赖安装失败：${install.stderr || install.error || ''}`);
if (lockPath) fs.copyFileSync(lockPath, path.join(runDir, 'requirements.lock.txt'));
const freeze = run(uvBin, ['pip', 'freeze', '--python', py], { cwd: runDir });
manifest.dependencies = freeze.stdout.split(/\r?\n/).filter(Boolean);
if (!lockPath) fs.writeFileSync(path.join(runDir, 'requirements.lock.txt'), manifest.dependencies.join('\n') + '\n');
manifest.lockFile = lockPath ? path.relative(runDir, lockPath) : 'generated-at-runtime';
console.log(`[复现] Python ${manifest.python.version.split(' ')[0]}，依赖 ${manifest.dependencies.length} 项${lockPath ? '（lock）' : ''}`);

// 3) 运行命令；默认多遍用于确定性比较
for (let i = 0; i < runsRequested; i++) {
  const runArtifacts = path.join(artifactsRoot, `run-${i + 1}`);
  fs.mkdirSync(runArtifacts, { recursive: true });
  const commandResults = [];
  for (const command of caseData.commands) {
    const cmdArgs = command.args.map((a) =>
      String(a).replaceAll('{python}', py).replaceAll('{repo}', repoDir),
    );
    const [bin, ...rest] = cmdArgs;
    const r = run(bin, rest, { cwd: repoDir, env: command.env || {} });
    const artifacts = (command.outputs || []).map((rel) => copyArtifact(rel, runArtifacts));
    const metrics = (caseData.metrics || []).map(readMetric);
    commandResults.push({ name: command.name, ...r, artifacts, metrics });
    console.log(`[复现] run ${i + 1}/${runsRequested} ${command.name}: exit=${r.status} ${r.durationMs}ms`);
    if (r.status !== 0) {
      // 失败也要落 manifest：stderr/exit code 是排查复现失败的关键证据
      manifest.runs.push({ index: i + 1, commands: commandResults, status: 'failed' });
      manifest.status = 'failed';
      manifest.finishedAt = new Date().toISOString();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      fail(`命令失败：${command.name}，见 ${manifestPath}`);
    }
    for (const a of artifacts) {
      if (!a.exists) fail(`产物缺失：${a.path}`);
    }
  }
  manifest.runs.push({ index: i + 1, commands: commandResults });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// 4) 指标校验（论文值/阈值）
const metricChecks = manifest.runs.flatMap((r) => r.commands.flatMap((c) => c.metrics || []));
manifest.metricChecks = metricChecks;
const failedMetrics = metricChecks.filter((m) => m.pass === false);
if (failedMetrics.length) {
  manifest.status = 'metric-mismatch';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fail(`指标未达阈值：${failedMetrics.map((m) => `${m.name}=${m.value}（期望 ${m.expected}±${m.tolerance}）`).join('；')}`);
}

// 5) 确定性比较（按相同相对产物路径）
if (runsRequested > 1) {
  const byRun = manifest.runs.map((r) => {
    const map = new Map();
    for (const c of r.commands) for (const a of c.artifacts) map.set(a.path, a.sha256);
    return map;
  });
  const keys = new Set([...byRun.flatMap((m) => [...m.keys()])]);
  const comparisons = [...keys].map((key) => {
    const hashes = byRun.map((m) => m.get(key) || null);
    return { path: key, hashes, equal: hashes.every((h) => h && h === hashes[0]) };
  });
  manifest.determinism = { runs: runsRequested, comparisons, allEqual: comparisons.every((c) => c.equal) };
  if (!manifest.determinism.allEqual) {
    manifest.status = 'determinism-mismatch';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fail('重复运行产物哈希不一致，见 manifest.determinism');
  }
}

manifest.status = 'completed';
manifest.finishedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n[复现完成] ${manifestPath}`);
