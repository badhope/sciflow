/**
 * 研究计划审计 CLI（从 cli.ts 拆出，避免入口膨胀）。
 *
 * `sciflow research plan-audit --file ./plan.md`
 * `sciflow research plan-audit --doc <documentId> --json`
 *
 * 纯函数审计：文件模式完全离线；文档模式只读一次文档 REST，不调用模型。
 */
import type { Command } from 'commander';
import { auditResearchPlan, type PlanAuditResult } from './plan-audit';

type Api = (path: string, opts?: { method?: string; body?: unknown }) => Promise<any>;

interface PlanAuditCliOptions {
  doc?: string;
  file?: string;
  title?: string;
  json?: boolean;
  failOnBlocker?: boolean;
}

/** 人类可读输出：先给结论，再按严重度列证据与建议，方便直接贴进修订清单。 */
export function renderPlanAudit(result: PlanAuditResult): string {
  const lines: string[] = [];
  lines.push(`# ${result.title || '(未命名研究计划)'}`);
  lines.push(result.ok ? `通过硬门禁  ${result.score}/100` : `未通过硬门禁  ${result.score}/100`);
  lines.push(`${result.blockers} 个 blocker / ${result.warnings} 个警告 / ${result.chars} 字`);
  lines.push(result.summary);

  const metrics = [
    result.metrics.t1Target !== undefined ? `T1 目标 ${result.metrics.t1Target} 人` : '',
    result.metrics.pairedTarget !== undefined ? `配对目标 ${result.metrics.pairedTarget} 对` : '',
    result.metrics.attritionPct !== undefined ? `流失 ${result.metrics.attritionPct}%` : '',
    result.metrics.t1Weeks ? `T1 ${result.metrics.t1Weeks}` : '',
    result.metrics.t2Weeks ? `T2 ${result.metrics.t2Weeks}` : '',
    result.metrics.gapWeeks !== undefined ? `实际间隔 ${result.metrics.gapWeeks} 周` : '',
    result.metrics.lagWeeks !== undefined ? `设计滞后 ${result.metrics.lagWeeks} 周` : '',
  ].filter(Boolean);
  if (metrics.length) lines.push(`指标：${metrics.join(' / ')}`);

  for (const severity of ['blocker', 'warning', 'info'] as const) {
    const findings = result.findings.filter((f) => f.severity === severity);
    if (!findings.length) continue;
    const heading = severity === 'blocker' ? '必须先修' : severity === 'warning' ? '投稿前关闭' : '提示';
    lines.push('', `${heading}：`);
    for (const f of findings) {
      lines.push(`  [${f.category}] ${f.message}`);
      if (f.evidence) lines.push(`    证据：${f.evidence}`);
      lines.push(`    建议：${f.suggestion}`);
    }
  }
  return lines.join('\n');
}

async function resolveContent(opts: PlanAuditCliOptions, localApi: Api): Promise<{ content: string; title: string }> {
  if (opts.doc && opts.file) throw new Error('--doc 与 --file 只能二选一');
  if (opts.doc) {
    const doc = await localApi(`/api/documents/${opts.doc}`);
    return { content: String(doc?.content || ''), title: opts.title?.trim() || String(doc?.title || '') };
  }
  if (opts.file) {
    const { readFileSync } = await import('node:fs');
    const path = opts.file === '-' ? 0 : opts.file;
    const content = readFileSync(path, 'utf-8');
    const fallback = opts.file === '-' ? 'stdin' : opts.file;
    return { content, title: opts.title?.trim() || fallback };
  }
  throw new Error('需要 --doc <id>、--file <path>，或 --file - 从 stdin 读取');
}

export function registerResearchCommands(program: Command, localApi: Api): void {
  const research = program.command('research').description('研究计划审计（确定性规则，不调模型）');

  research
    .command('plan-audit')
    .description('检查研究计划的样本流、周期间隔、构念、量表、查新、选刊与术语一致性')
    .option('--doc <id>', '文档 ID（读后端文档）')
    .option('--file <path>', '本地 Markdown/文本文件；- 表示 stdin')
    .option('--title <text>', '覆盖结果中的标题')
    .option('--json', '输出完整 JSON（便于 CI 存档）')
    .option('--fail-on-blocker', '存在 blocker 时以退出码 1 结束（CI 门禁）')
    .action(async (opts: PlanAuditCliOptions) => {
      const { content, title } = await resolveContent(opts, localApi);
      if (!content.trim()) throw new Error('计划正文为空');
      if (content.length > 500_000) throw new Error('计划正文超过 500000 字上限');
      const result = auditResearchPlan(content, title);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderPlanAudit(result));
      }
      if (opts.failOnBlocker && !result.ok) process.exitCode = 1;
    });
}
