#!/usr/bin/env node
/**
 * 多轮经济学研究循环（规则驱动骨架）。
 *
 * PI → Experimenter → Critic，最多 N 轮：
 *  - PI 为每个 variant 建协议并批准（--auto-approve）
 *  - Experimenter 跑 Python 分析，产出量化指标
 *  - Critic 按 expected/tolerance 判定；不通过则记录 refuted，进入下一轮
 *  - 通过则记录 supported 并停止
 *
 * 用法：
 *   node reproduction/run-econ-loop.mjs \
 *     --api http://127.0.0.1:43100 --program <programId> \
 *     --case reproduction/cases/card-1995-returns-schooling.json \
 *     --python D:/sciflow-research/data/reproduction/econ/venv/Scripts/python.exe \
 *     --question "Card (1995) 的教育回报率能否复现？" --auto-approve
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const has = (name) => args.includes(`--${name}`);

const apiBase = String(arg('api', 'http://127.0.0.1:3000')).replace(/\/$/, '');
const programId = arg('program', '');
if (!programId) {
  console.error('缺少 --program <programId>');
  process.exit(2);
}
const casePath = path.resolve(arg('case', 'reproduction/cases/card-1995-returns-schooling.json'));
const caseData = JSON.parse(fs.readFileSync(casePath, 'utf8'));
const python = path.resolve(arg('python', 'D:/sciflow-research/data/reproduction/econ/venv/Scripts/python.exe'));
const analysis = path.resolve(arg('analysis', caseData.reproduction.code));
const outRoot = path.resolve(arg('outdir', path.join(process.cwd(), '..', 'data', 'reproduction-runs')));
const questionText = arg('question', '');
const questionIdArg = arg('question-id', '');
const maxCycles = Math.max(1, Math.min(5, Number(arg('max-cycles', String(caseData.variants?.length || 1))) || 1));
const autoApprove = has('auto-approve');

if (!fs.existsSync(python)) {
  console.error(`Python 不存在：${python}`);
  process.exit(2);
}
if (!fs.existsSync(analysis)) {
  console.error(`分析脚本不存在：${analysis}`);
  process.exit(2);
}

async function api(pathname, method = 'GET', body, attempt = 0) {
  try {
    const res = await fetch(`${apiBase}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${pathname} HTTP ${res.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    const msg = String(e?.message || e);
    if (attempt < 3 && /fetch failed|ECONN|socket|aborted|UND_ERR/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return api(pathname, method, body, attempt + 1);
    }
    throw e;
  }
}

function getPath(obj, dotted) {
  return String(dotted || '').split('.').filter(Boolean).reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function log(role, message) {
  console.log(`[${role}] ${message}`);
}

function evaluateMetrics(result, metrics) {
  return (metrics || []).map((m) => {
    const raw = getPath(result, m.jsonPath || m.name);
    const value = Number(raw);
    const expected = m.expected == null ? null : Number(m.expected);
    const tolerance = Number(m.tolerance ?? 0);
    const pass = expected == null || (Number.isFinite(value) && Math.abs(value - expected) <= tolerance);
    return { name: m.name, value: Number.isFinite(value) ? value : raw, expected, tolerance, pass };
  });
}

function runAnalysis(spec, outFile) {
  const started = Date.now();
  const r = spawnSync(python, [analysis, '--spec', spec, '--out', outFile], {
    cwd: path.dirname(analysis),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  return {
    status: r.status,
    durationMs: Date.now() - started,
    stdout: (r.stdout || '').slice(0, 4000),
    stderr: (r.stderr || '').slice(0, 4000),
    error: r.error ? String(r.error.message || r.error) : '',
  };
}

// ---------- PI：问题与假设 ----------
let questionId = questionIdArg;
if (!questionId) {
  if (!questionText.trim()) {
    console.error('需要 --question "..." 或 --question-id <id>');
    process.exit(2);
  }
  const q = await api(`/api/programs/${programId}/questions`, 'POST', {
    question: questionText.trim(),
    scope: `复现 ${caseData.id}；OLS/2SLS；CPU；指标阈值见案例`,
  });
  questionId = q.id;
  log('PI', `创建研究问题 ${questionId}`);
}
const hypothesis = await api(`/api/programs/questions/${questionId}/hypotheses`, 'POST', {
  statement: `控制设定下 ${caseData.paper.title} 的 OLS/IV 教育回报系数接近论文值`,
  rationale: '使用 wooldridge.card 数据；Card (1995) 报告 OLS≈0.074、IV≈0.132',
  predictions: caseData.reproductionCriteria || [],
});
log('PI', `创建假设 ${hypothesis.id}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(outRoot, `${caseData.id}-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const summary = {
  case: caseData.id,
  programId,
  questionId,
  hypothesisId: hypothesis.id,
  cycles: [],
  verdict: null,
};

for (let i = 0; i < Math.min(maxCycles, caseData.variants?.length || 0); i++) {
  const variant = caseData.variants[i];
  const protocol = await api(`/api/programs/hypotheses/${hypothesis.id}/protocols`, 'POST', {
    design: {
      variant: variant.id,
      label: variant.label,
      spec: variant.spec,
      metrics: variant.metrics,
      analysis,
      data: caseData.reproduction.data,
    },
  });
  log('PI', `第 ${i + 1} 轮：协议 ${protocol.id}（${variant.label}）`);

  if (!autoApprove) {
    log('PI', '协议待人工批准；使用 --auto-approve 继续。');
    summary.verdict = 'awaiting_approval';
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }
  await api(`/api/programs/protocols/${protocol.id}/approve`, 'POST');

  // ---------- Experimenter ----------
  const resultFile = path.join(outDir, `${variant.id}.json`);
  log('Experimenter', `运行 ${variant.spec}…`);
  const exec = runAnalysis(variant.spec, resultFile);
  if (exec.status !== 0 || !fs.existsSync(resultFile)) {
    log('Experimenter', `分析失败 exit=${exec.status} ${exec.stderr || exec.error}`);
    process.exit(1);
  }
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const metrics = evaluateMetrics(result, variant.metrics);
  const pass = metrics.every((m) => m.pass !== false);
  log('Experimenter', metrics.map((m) => `${m.name}=${m.value}${m.expected == null ? '' : `（期望 ${m.expected}±${m.tolerance}）`}`).join('；'));

  // 创建一个 cycle 对象记录这一轮（每轮独立）
  const cycle = await api(`/api/programs/${programId}/cycles`, 'POST', {
    objective: `第 ${i + 1} 轮：${variant.label}`,
    state: 'report',
  });

  const run = await api(`/api/programs/${programId}/runs`, 'POST', {
    cycleId: cycle.id,
    protocolId: protocol.id,
    status: 'completed',
    summary: `${variant.label}：${metrics.map((m) => `${m.name}=${m.value}`).join('；')}`,
    manifest: {
      source: 'econ-agent-loop',
      caseId: caseData.id,
      variant: variant.id,
      spec: variant.spec,
      python,
      analysis,
      result,
      metrics,
      startedAt: Date.now() - exec.durationMs,
      durationMs: exec.durationMs,
    },
  });
  log('Experimenter', `run=${run.id}`);

  // ---------- Critic ----------
  const verdict = pass ? 'supported' : 'refuted';
  const claim = await api(`/api/programs/${programId}/claims`, 'POST', {
    statement: pass
      ? `${caseData.id} 在 ${variant.label} 下复现达标`
      : `${caseData.id} 在 ${variant.label} 下未达标：${metrics.filter((m) => !m.pass).map((m) => `${m.name}=${m.value}`).join('；')}`,
    cycleId: cycle.id,
    protocolId: protocol.id,
    confidence: pass ? 90 : 20,
    status: verdict,
  });
  await api(`/api/programs/claims/${claim.id}/evidence`, 'POST', {
    sourceType: 'experiment',
    sourceId: run.id,
    stance: pass ? 'supports' : 'refutes',
    strength: 5,
    quote: metrics.map((m) => `${m.name}=${m.value}（期望 ${m.expected}±${m.tolerance}）`).join('；'),
    verified: true,
  });
  log('Critic', `${verdict}：claim=${claim.id}`);

  summary.cycles.push({
    index: i + 1,
    variant: variant.id,
    label: variant.label,
    cycleId: cycle.id,
    protocolId: protocol.id,
    runId: run.id,
    claimId: claim.id,
    verdict,
    metrics,
  });

  if (pass) {
    summary.verdict = 'supported';
    break;
  }
  log('PI', 'Critic 未通过；进入下一轮修订。');
}

if (!summary.verdict) summary.verdict = 'refuted';
console.log(JSON.stringify(summary, null, 2));
if (summary.verdict !== 'supported') process.exit(1);
