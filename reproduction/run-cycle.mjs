#!/usr/bin/env node
/**
 * 三角色研究循环骨架（规则驱动，可替换为 LLM 智能体）。
 *
 * 角色：
 *  - PI：创建/复用研究问题 → 假设 → 协议；可自动批准（需显式 --auto-approve）
 *  - Experimenter：运行 reproduction/run-case.mjs，并用 publish-run.mjs 写入 research_run
 *  - Critic：读取 manifest，判断确定性/指标，写 Claim + Evidence，更新 Claim 状态
 *
 * 用法：
 *   node reproduction/run-cycle.mjs \
 *     --api http://127.0.0.1:43100 \
 *     --program <programId> \
 *     --case reproduction/cases/plass-stone-1983.json \
 *     --question "该复现是否可稳定重跑？" \
 *     --auto-approve \
 *     --uv "C:/Program Files/Python315/Scripts/uv.exe"
 *
 * 说明：
 *  - 这是“编排骨架”：角色决策是确定性的，用于验证闭环；
 *  - 后续把 PI/Critic 的决策函数替换为模型调用即可，不改 API 与数据流；
 *  - 不自动投稿、不调用外部模型、不修改 harness 产物。
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
const casePath = path.resolve(arg('case', 'reproduction/cases/plass-stone-1983.json'));
if (!fs.existsSync(casePath)) {
  console.error(`找不到 case：${casePath}`);
  process.exit(2);
}
const caseData = JSON.parse(fs.readFileSync(casePath, 'utf8'));
const questionText = arg('question', '');
const questionIdArg = arg('question-id', '');
const cycleIdArg = arg('cycle', '');
const autoApprove = has('auto-approve');
const runs = Math.max(1, Math.min(3, Number(arg('runs', '2')) || 2));
const uv = arg('uv', process.env.UV_BIN || 'uv');
const repoCache = arg('repo-cache', '');
const workdir = path.resolve(arg('workdir', path.join(process.cwd(), '..', 'data', 'reproduction-runs')));
const projectRoot = process.cwd();

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
    // 长任务后 keep-alive 连接可能被服务端关闭；仅对连接类错误做有限重试
    if (attempt < 3 && /fetch failed|ECONN|socket|aborted|UND_ERR/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return api(pathname, method, body, attempt + 1);
    }
    throw e;
  }
}

function log(role, message) {
  console.log(`[${role}] ${message}`);
}

function runNode(script, scriptArgs) {
  const r = spawnSync(process.execPath, [path.join(projectRoot, script), ...scriptArgs], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? String(r.error.message || r.error) : '' };
}

// ---------- PI ----------
log('PI', `研究目标：${caseData.title}`);
let questionId = questionIdArg;
if (!questionId) {
  if (!questionText.trim()) {
    console.error('需要 --question "..." 或 --question-id <id>');
    process.exit(2);
  }
  const q = await api(`/api/programs/${programId}/questions`, 'POST', {
    question: questionText.trim(),
    scope: `复现 ${caseData.id}；CPU；判据=${(caseData.reproductionCriteria || []).join(' / ')}`,
  });
  questionId = q.id;
  log('PI', `创建研究问题 ${questionId}`);
}

let cycleId = cycleIdArg;
if (!cycleId) {
  const c = await api(`/api/programs/${programId}/cycles`, 'POST', {
    objective: `复现 ${caseData.id}，锁定 commit/环境，运行 ${runs} 遍并核对指标`,
  });
  cycleId = c.id;
  log('PI', `创建研究循环 ${cycleId}`);
}

const hypothesis = await api(`/api/programs/questions/${questionId}/hypotheses`, 'POST', {
  statement: `在锁定 commit 与依赖后，${caseData.id} 的产物可重复且指标达到预设阈值`,
  rationale: `使用 ${caseData.reproduction.repo} @ ${caseData.reproduction.commit}`,
  predictions: (caseData.reproductionCriteria || []).slice(0, 5),
});
log('PI', `创建假设 ${hypothesis.id}`);

const protocol = await api(`/api/programs/hypotheses/${hypothesis.id}/protocols`, 'POST', {
  design: {
    caseId: caseData.id,
    repo: caseData.reproduction.repo,
    commit: caseData.reproduction.commit,
    python: caseData.python,
    runs,
    criteria: caseData.reproductionCriteria || [],
    metrics: caseData.metrics || [],
  },
});
log('PI', `创建协议 ${protocol.id}（v${protocol.version}）`);

if (!autoApprove) {
  log('PI', '协议待人工批准；使用 --auto-approve 才会继续执行。');
  console.log(JSON.stringify({ programId, questionId, cycleId, hypothesisId: hypothesis.id, protocolId: protocol.id, status: 'awaiting_approval' }, null, 2));
  process.exit(0);
}
await api(`/api/programs/protocols/${protocol.id}/approve`, 'POST');
log('PI', '协议已自动批准（显式 --auto-approve）');

// ---------- Experimenter ----------
log('Experimenter', `运行 harness：${caseData.id}，${runs} 遍`);
const harness = runNode('reproduction/run-case.mjs', [
  '--case', casePath,
  '--workdir', workdir,
  '--uv', uv,
  '--runs', String(runs),
  ...(repoCache ? ['--repo-cache', repoCache] : []),
]);
if (harness.stdout) console.log(harness.stdout.trim());
if (harness.stderr) console.error(harness.stderr.trim());

const manifestMatch = harness.stdout.match(/\[复现完成\]\s+(.+manifest\.json)/) || harness.stderr.match(/\[复现完成\]\s+(.+manifest\.json)/);
if (!manifestMatch) {
  log('Experimenter', `harness 未产出完成 manifest（exit=${harness.status}）`);
  process.exit(1);
}
const manifestPath = manifestMatch[1].trim();
log('Experimenter', `manifest=${manifestPath}`);

const publish = runNode('reproduction/publish-run.mjs', [
  '--manifest', manifestPath,
  '--program', programId,
  '--cycle', cycleId,
  '--protocol', protocol.id,
  '--api', apiBase,
]);
if (publish.stdout) console.log(publish.stdout.trim());
if (publish.stderr) console.error(publish.stderr.trim());
if (publish.status !== 0) process.exit(1);
const runId = (publish.stdout.match(/research_run:\s*([^\s]+)/) || [])[1];
if (!runId) {
  log('Experimenter', '未解析到 runId');
  process.exit(1);
}
log('Experimenter', `run=${runId}`);

// ---------- Critic ----------
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const deterministic = manifest.determinism?.allEqual === true;
const metricChecks = manifest.metricChecks || [];
const metricsPass = metricChecks.every((m) => m.pass !== false);
const pass = manifest.status === 'completed' && deterministic && metricsPass;
const metricText = metricChecks.length
  ? metricChecks.map((m) => `${m.name}=${m.value}${m.expected == null ? '' : `（期望 ${m.expected}±${m.tolerance}）`}`).join('；')
  : '无显式指标，按产物确定性判定';

log('Critic', `确定性=${deterministic} 指标=${metricsPass} 结论=${pass ? '支持' : '不支持'}`);
log('Critic', metricText);

const claim = await api(`/api/programs/${programId}/claims`, 'POST', {
  statement: pass
    ? `${caseData.id} 在锁定环境下可重复复现，${runs} 遍产物一致${metricChecks.length ? '且指标达标' : ''}`
    : `${caseData.id} 未达到复现判据：确定性=${deterministic}，指标=${metricsPass}`,
  cycleId,
  protocolId: protocol.id,
  confidence: pass ? 90 : 25,
  status: pass ? 'supported' : 'refuted',
});
log('Critic', `创建结论 ${claim.id}`);

await api(`/api/programs/claims/${claim.id}/evidence`, 'POST', {
  sourceType: 'experiment',
  sourceId: runId,
  stance: pass ? 'supports' : 'refutes',
  strength: 5,
  quote: `manifest=${path.basename(manifestPath)}；determinism=${deterministic}；${metricText}`,
  verified: true,
});
log('Critic', '已登记实验证据并标记已核验');

console.log(JSON.stringify({
  programId,
  questionId,
  cycleId,
  hypothesisId: hypothesis.id,
  protocolId: protocol.id,
  runId,
  claimId: claim.id,
  verdict: pass ? 'supported' : 'refuted',
  manifestPath,
  metricChecks,
}, null, 2));
