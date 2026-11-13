#!/usr/bin/env node
/**
 * 把复现 harness 的 manifest 发布为 research_run。
 *
 * 用法：
 *   node reproduction/publish-run.mjs \
 *     --manifest D:/sciflow-research/data/reproduction-runs/<run>/manifest.json \
 *     --program <programId> \
 *     --api http://127.0.0.1:43100
 *
 * 可选：
 *   --cycle <cycleId> --protocol <protocolId> --dry-run
 *
 * 说明：
 *  - 只发布摘要与产物哈希，不把 stdout/stderr 全量写入数据库；
 *  - determinism.allEqual=false 时 status=failed，避免把不确定复现标成成功；
 *  - 不读取模型密钥，不改变 harness 产物。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const manifestPath = path.resolve(arg('manifest', ''));
if (!manifestPath || !fs.existsSync(manifestPath)) {
  console.error('缺少或找不到 --manifest <manifest.json>');
  process.exit(2);
}
const programId = arg('program', '');
if (!programId) {
  console.error('缺少 --program <programId>');
  process.exit(2);
}
const apiBase = String(arg('api', 'http://127.0.0.1:3000')).replace(/\/$/, '');
const cycleId = arg('cycle', '');
const protocolId = arg('protocol', '');
const dryRun = args.includes('--dry-run');

const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!m.case || !m.repo || !Array.isArray(m.runs)) {
  console.error('manifest 结构不符合预期：缺少 case/repo/runs');
  process.exit(2);
}
const allEqual = m.determinism?.allEqual === true;
const artifacts = m.runs.flatMap((r) =>
  (r.commands || []).flatMap((c) => (c.artifacts || []).filter((a) => a.exists).map((a) => ({
    run: r.index,
    command: c.name,
    path: a.path,
    bytes: a.bytes,
    sha256: a.sha256,
  }))),
);
const payload = {
  status: allEqual ? 'completed' : 'failed',
  cycleId: cycleId || undefined,
  protocolId: protocolId || undefined,
  startedAt: Number.isFinite(Date.parse(m.startedAt)) ? Date.parse(m.startedAt) : undefined,
  endedAt: Number.isFinite(Date.parse(m.finishedAt)) ? Date.parse(m.finishedAt) : undefined,
  summary: `复现 ${m.case.id} @ ${String(m.repo.commit || '').slice(0, 8)}；${m.runs.length} 遍，确定性${allEqual ? '通过' : '未通过'}；产物 ${artifacts.length} 个`,
  manifest: {
    source: 'sciflow-reproduction-harness',
    caseId: m.case.id,
    caseTitle: m.case.title,
    paper: m.case.paper,
    reproduction: {
      repo: m.repo.url,
      commit: m.repo.commit,
      license: m.repo.license,
      title: m.case.reproduction?.title,
      venue: m.case.reproduction?.venue,
    },
    python: m.python,
    dependencies: m.dependencies,
    lockFile: m.lockFile,
    determinism: m.determinism,
    artifacts,
    runs: m.runs.map((r) => ({
      index: r.index,
      commands: (r.commands || []).map((c) => ({
        name: c.name,
        status: c.status,
        durationMs: c.durationMs,
        artifacts: (c.artifacts || []).map((a) => ({ path: a.path, bytes: a.bytes, sha256: a.sha256, exists: a.exists })),
      })),
    })),
    finishedAt: m.finishedAt,
    manifestPath,
  },
};

if (dryRun) {
  console.log(JSON.stringify({ apiBase, programId, ...payload }, null, 2));
  process.exit(0);
}

const res = await fetch(`${apiBase}/api/programs/${encodeURIComponent(programId)}/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const text = await res.text();
if (!res.ok) {
  console.error(`发布失败 HTTP ${res.status}: ${text}`);
  process.exit(1);
}
const run = JSON.parse(text);
console.log(`已发布 research_run: ${run.id}`);
console.log(`status=${run.status} program=${run.programId} artifacts=${artifacts.length}`);
