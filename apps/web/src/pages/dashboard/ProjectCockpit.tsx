import type { DashboardOverview, Doc, Project } from '../../types';
import type { View } from '../../App';
import { deriveStages, type StageState } from '../../lib/stages';
import { Badge, Button, Card } from '../../components/ui';
import { ArrowRight, CheckCircle2, Circle, Clock3, Workflow, AlertTriangle } from 'lucide-react';

/**
 * ProjectCockpit —— 项目驾驶舱（v2.0 信息架构重构的核心组件）。
 *
 * 为什么需要：旧「项目总览」页是 4 个指标卡 + 全链路卡 + 环形图 + 执行追踪平铺，
 * 用户能读到所有数字，却回答不了三个最基本的问题：
 *   1）我现在处在研究的哪一步？  2）下一步该点哪个按钮？  3）稿件达没达到投稿标准？
 * 本组件把这三件事放在首屏唯一的主区域，其余统计降为次级区块。
 *
 * 设计约束：
 *  - 阶段推断复用 lib/stages 的 deriveStages（单一事实源，已有 5 条单测），不另写一套口径；
 *  - 「下一步」由阶段推断得出而非硬编码文案，空项目也能给出正确的第一步；
 *  - 质量门状态只读客观分与所选标准（不引入新请求），标准缺失时显示「未评分」而非假绿。
 */
export interface QualityGateState {
  /** 当前文档的客观分（无则 null） */
  score: number | null;
  /** 所选标准的及格线（未知时 null） */
  passScore: number | null;
  /** 标准名（如「SCI 通用期刊」） */
  standardLabel: string | null;
  /** 硬伤数 */
  hardFailCount: number;
}

export function ProjectCockpit({
  project,
  docs,
  overview,
  gate,
  submissionCount,
  onNavigate,
  onOpenDoc,
}: {
  project: Project;
  docs: Doc[];
  overview: DashboardOverview | null;
  gate: QualityGateState;
  /** 投稿跟踪条数（概览接口未含此字段，由上层单独查询后传入） */
  submissionCount: number;
  onNavigate: (v: View) => void;
  onOpenDoc: (id: string) => void;
}) {
  const hasContent = docs.some((d) => (d.content || '').trim().length > 0);
  const reviewedDocCount = docs.filter((d) => ['reviewing', 'polished', 'final'].includes(String(d.status))).length;
  const stages: StageState[] = deriveStages({
    project,
    overview,
    docCount: docs.length,
    hasContent,
    score: gate.score,
    reviewedDocCount,
    submissionCount: submissionCount,
    view: 'dashboard',
  });
  const current = stages.find((s) => s.current) ?? stages[0];
  const doneCount = stages.filter((s) => s.done).length;

  /** 下一步动作：由当前阶段派生，给出可点击的具体动作而不是形容词 */
  const nextAction = (): { label: string; view: View; detail: string } => {
    switch (current.key) {
      case 'research':
        return {
          label: docs.length === 0 ? '运行一次流水线' : '回到工作台继续对话',
          view: docs.length === 0 ? 'pipeline' : 'workspace',
          detail:
            docs.length === 0
              ? '输入研究主题，自动完成选题验证 → 文献调研 → 大纲 → 起草 → 质量门'
              : '在工作台与 AI 讨论选题，或直接在流水线里发起全自动任务',
        };
      case 'literature':
        return {
          label: '检索并导入文献',
          view: 'literature',
          detail: '学术库免 Key 直查 OpenAlex / Crossref / arXiv，导入后自动去重入本地库',
        };
      case 'outline':
        return {
          label: '确认章节大纲',
          view: 'pipeline',
          detail: '大纲需人工确认后才进入起草；可切换「反共识变体」对比不同组织方式',
        };
      case 'draft':
        return { label: '继续起草与润色', view: 'writing', detail: '分章起草，起草前自动注入文献池与项目写作偏好' };
      case 'review':
        return {
          label: '跑质量门并回炉',
          view: 'quality',
          detail: gate.passScore ? `当前标准「${gate.standardLabel}」及格 ${gate.passScore} 分` : '按所选标准判定，未达标自动回炉',
        };
      default:
        return { label: '选刊与投稿跟踪', view: 'submission', detail: '按主题匹配期刊、生成 Cover Letter、跟踪修回到录用' };
    }
  };
  const next = nextAction();

  const gateTone = gate.score == null ? 'slate' : gate.passScore != null && gate.score >= gate.passScore ? 'green' : 'amber';

  return (
    <Card className="mb-6 p-5" id="project-cockpit">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">项目驾驶舱</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          阶段 {doneCount}/{stages.length} 完成 · 当前：<b className="text-slate-700 dark:text-slate-200">{current.label}</b>
        </span>
      </div>

      {/* 阶段进度：横向六段，已完成打勾、当前高亮、有卡点带数字 */}
      <ol className="mb-5 flex flex-wrap items-center gap-1.5" aria-label="研究阶段进度">
        {stages.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onNavigate(s.view as View)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                s.current
                  ? 'border-teal-500 bg-teal-50 font-medium text-teal-800 dark:border-teal-600 dark:bg-teal-950/40 dark:text-teal-200'
                  : s.done
                    ? 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'
                    : 'border-dashed border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700'
              }`}
              title={s.hint}
              aria-current={s.current ? 'step' : undefined}
            >
              {s.done ? <CheckCircle2 size={12} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
              {s.label}
              {s.pending > 0 && (
                <span className="rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-4 text-white">{s.pending}</span>
              )}
            </button>
            {s.key !== stages[stages.length - 1].key && <ArrowRight size={11} className="text-slate-300 dark:text-slate-600" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {/* 下一步 + 质量门：首屏唯一主行动区 */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3.5 dark:border-teal-900/60 dark:bg-teal-950/20">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-teal-700 dark:text-teal-300">下一步</div>
          <div className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{next.label}</div>
          <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{next.detail}</p>
          <Button onClick={() => onNavigate(next.view)} className="text-xs">
            <Workflow size={13} aria-hidden="true" /> 前往{current.label}阶段
          </Button>
        </div>

        <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">质量门</span>
            <Badge tone={gateTone as 'green' | 'amber' | 'slate'}>
              {gate.score == null ? '未评分' : `${gate.score}/100`}
            </Badge>
          </div>
          {gate.score == null ? (
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              还没有客观分。质量门用确定性规则评分（同文本必然同分），不依赖模型打分。
            </p>
          ) : (
            <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
              <div>
                标准：{gate.standardLabel || '未知'}
                {gate.passScore != null && <span className="text-slate-400"> · 及格 {gate.passScore}</span>}
              </div>
              <div className={gate.hardFailCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                {gate.hardFailCount > 0 ? (
                  <span className="flex items-center gap-1">
                    <AlertTriangle size={11} aria-hidden="true" /> {gate.hardFailCount} 项硬伤，封顶 40 分
                  </span>
                ) : (
                  '无硬伤'
                )}
              </div>
              {docs[0] && (
                <button type="button" className="mt-1 text-[11px] text-teal-700 hover:underline dark:text-teal-300" onClick={() => onOpenDoc(docs[0].id)}>
                  查看评分详情 →
                </button>
              )}
            </div>
          )}
          {gate.passScore != null && gate.score != null && gate.score < gate.passScore && (
            <div className="mt-2 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
              <Clock3 size={11} aria-hidden="true" /> 距及格还差 {gate.passScore - gate.score} 分
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
