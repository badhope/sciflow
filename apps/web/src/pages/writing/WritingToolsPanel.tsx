import { ClipboardCheck, FlaskConical, Gauge, History, Loader2, Mail, MessageSquare, Sparkles, Upload, ArrowDownToLine, Trash2 } from 'lucide-react';
import { Badge, Button, Select, Spinner, Textarea } from '../../components/ui';
import { HBar } from '../../components/charts';
import type { DocVersionEntry, Experiment, Outline, QualityReport, ReviewComment, SimulatedReviewResult, ResearchDesignResult } from '../../types';

/**
 * WritingToolsPanel —— 写作页「AI 工具」标签页内容。
 *
 * 从 WritingPage 内联的 440 行右栏抽出：原来它和 大纲 / ChatPanel / 编辑器 挤在同一行，
 * 在 1024–1440 宽度下被压成 39px（文字竖排）。现在它只出现在底部 Tab 里，独占可用宽度。
 *
 * 组件保持纯展示 + 回调，状态全部留在 WritingPage（不做第二份状态源）。
 */
export interface WritingToolsPanelProps {
  aiBusy: boolean;
  /* 摘要 */
  abstractResult: { abstract: string; keywords: string[] } | null;
  onGenerateAbstract: () => void;
  onInsertAbstract: () => void;
  /* 研究设计 */
  designIdea: string;
  onDesignIdea: (v: string) => void;
  designResult: ResearchDesignResult | null;
  onRunDesign: () => void;
  /* 章节起草 */
  outline: Outline | null;
  sectionTarget: string;
  onSelectSection: (v: string) => void;
  /* 润色 / 翻译 */
  onPolish: (mode: 'polish' | 'reduce') => void;
  translateTarget: 'zh' | 'en';
  onTranslateTarget: (v: string) => void;
  onTranslate: () => void;
  polishResult: { original: string; polished: string; reason: string } | null;
  onApplyPolished: () => void;
  onDismissPolish: () => void;
  /* 模拟评审 */
  reviewResult: SimulatedReviewResult | null;
  onRunReview: () => void;
  /* 审稿意见闭环 */
  reviewComments: ReviewComment[];
  commentsOpen: boolean;
  onToggleComments: () => void;
  commentsLoading: boolean;
  onGenerateLetter: () => void;
  onImportComments: () => void;
  generatingLetter: boolean;
  importingComments: boolean;
  onChangeCommentStatus: (c: ReviewComment, status: 'open' | 'resolved' | 'deferred') => void;
  replyId: string | null;
  replyDraft: string;
  onReplyDraft: (v: string) => void;
  onStartReply: (c: ReviewComment) => void;
  onCancelReply: () => void;
  onSaveReply: (c: ReviewComment) => void;
  savingReply: boolean;
  onRemoveComment: (c: ReviewComment) => void;
  letter: string | null;
  /* 质量 */
  qualityReport: QualityReport | null;
  qualityScores: Record<string, number>;
  scoreColor: (v: number, good?: number, mid?: number) => string | undefined;
  /* 实验 */
  docExperiments: Experiment[];
  experimentsOpen: boolean;
  onToggleExperiments: () => void;
  onInsertExperiment: (e: Experiment) => void;
  /* 版本 */
  versionsOpen: boolean;
  onToggleVersions: () => void;
  snapshots: (DocVersionEntry & { current?: boolean })[];
  onOpenDiff: () => void;
  /** 手动创建版本快照（后端 POST /documents/:id/snapshot） */
  snapshotMsg: string;
  snapshotBusy: boolean;
  onSnapshotMsg: (v: string) => void;
  onCreateSnapshot: () => void;
}

const SEC = 'text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5';
const COMMENT_STATUS: Record<string, { label: string; tone: 'amber' | 'green' | 'slate' }> = {
  open: { label: '待处理', tone: 'amber' },
  resolved: { label: '已解决', tone: 'green' },
  deferred: { label: '暂缓', tone: 'slate' },
};

export function WritingToolsPanel(props: WritingToolsPanelProps) {
  const {
    aiBusy,
    abstractResult, onGenerateAbstract, onInsertAbstract,
    designIdea, onDesignIdea, designResult, onRunDesign,
    outline, sectionTarget, onSelectSection,
    onPolish, translateTarget, onTranslateTarget, onTranslate,
    polishResult, onApplyPolished, onDismissPolish,
    reviewResult, onRunReview,
    reviewComments, commentsOpen, onToggleComments, commentsLoading,
    onGenerateLetter, onImportComments, generatingLetter, importingComments,
    onChangeCommentStatus, replyId, replyDraft, onReplyDraft, onStartReply, onCancelReply, onSaveReply, savingReply, onRemoveComment, letter,
    qualityReport, qualityScores, scoreColor,
    docExperiments, experimentsOpen, onToggleExperiments, onInsertExperiment,
    versionsOpen, onToggleVersions, snapshots, onOpenDiff,
    snapshotMsg, snapshotBusy, onSnapshotMsg, onCreateSnapshot,
  } = props;

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {/* 摘要与关键词 */}
      <section>
        <div className={SEC}>论文摘要 + 关键词</div>
        <Button variant="outline" className="text-xs w-full" onClick={onGenerateAbstract} disabled={aiBusy}>
          <Sparkles size={12} className="text-teal-600" aria-hidden="true" /> 生成摘要与关键词
        </Button>
        {abstractResult && (
          <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50 p-2 text-xs text-slate-700 dark:border-teal-800 dark:bg-teal-900/20 dark:text-slate-300">
            <div className="mb-1 font-medium text-teal-700 dark:text-teal-300">摘要</div>
            <div className="mb-2 leading-relaxed">{abstractResult.abstract}</div>
            <div className="mb-1 font-medium text-teal-700 dark:text-teal-300">关键词</div>
            <div className="flex flex-wrap gap-1">
              {abstractResult.keywords.map((k, i) => (
                <span key={i} className="rounded border border-teal-200 bg-white px-1.5 py-0.5 dark:border-teal-800 dark:bg-slate-900">{k}</span>
              ))}
            </div>
            <button className="mt-2 text-teal-600 underline dark:text-teal-400" onClick={onInsertAbstract}>
              插入到正文顶部
            </button>
          </div>
        )}
      </section>

      {/* 研究设计诊断 */}
      <section>
        <div className={SEC}>研究设计诊断（新颖性 / 可行性 / 风险）</div>
        <Textarea rows={2} placeholder="描述你的研究想法…" value={designIdea} onChange={(e) => onDesignIdea(e.target.value)} className="mb-2" />
        <Button variant="outline" className="text-xs w-full" onClick={onRunDesign} disabled={aiBusy || !designIdea.trim()}>
          <FlaskConical size={12} className="text-teal-600" aria-hidden="true" /> 诊断研究想法
        </Button>
        {designResult && !('error' in designResult) && (
          <div className="mt-2 space-y-2 text-xs">
            <HBar
              max={100}
              items={[
                { label: '新颖性', value: designResult.noveltyScore, sub: designResult.noveltyFeedback.slice(0, 14) + '…', color: scoreColor(designResult.noveltyScore), hint: designResult.noveltyFeedback },
                { label: '可行性', value: designResult.feasibilityScore, sub: designResult.feasibilityFeedback.slice(0, 14) + '…', color: scoreColor(designResult.feasibilityScore), hint: designResult.feasibilityFeedback },
              ]}
            />
            <div className="rounded-lg border border-slate-100 p-2 leading-relaxed dark:border-slate-800">
              <div><span className="font-medium text-teal-700 dark:text-teal-300">新颖性：</span>{designResult.noveltyFeedback}</div>
              <div><span className="font-medium text-sky-700 dark:text-sky-300">可行性：</span>{designResult.feasibilityFeedback}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50/30 p-2 dark:border-amber-900 dark:bg-amber-900/10">
              <div className="mb-0.5 text-amber-600 dark:text-amber-400">风险</div>
              <ul className="list-disc pl-4">{designResult.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          </div>
        )}
      </section>

      {/* 章节起草 */}
      <section>
        <div className={SEC}>章节起草</div>
        <Select
          options={[{ value: '', label: '选择要起草的章节…' }, ...(outline?.sections || []).map((s) => ({ value: s.title, label: s.title }))]}
          value={sectionTarget}
          onChange={onSelectSection}
        />
      </section>

      {/* 润色 / 降重 / 翻译 */}
      <section>
        <div className={SEC}>润色 / 降重 / 翻译（默认全文，可先选中文本）</div>
        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" onClick={() => onPolish('polish')} disabled={aiBusy}>学术润色</Button>
          <Button className="flex-1" variant="outline" onClick={() => onPolish('reduce')} disabled={aiBusy}>降重改写</Button>
        </div>
        <div className="mt-2 flex gap-2">
          <Select
            className="flex-1"
            options={[{ value: 'zh', label: '英 → 中' }, { value: 'en', label: '中 → 英' }]}
            value={translateTarget}
            onChange={onTranslateTarget}
          />
          <Button className="flex-1" variant="outline" onClick={onTranslate} disabled={aiBusy}>翻译</Button>
        </div>
        {polishResult && (
          <div className="mt-2 rounded-lg border border-teal-200 bg-slate-50 p-2 text-xs dark:border-teal-800 dark:bg-slate-900/50">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-teal-700 dark:text-teal-300">三段式结果</span>
              <div className="flex gap-1">
                <Button variant="success" className="px-2 py-0.5 text-xs" onClick={onApplyPolished}>应用</Button>
                <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={onDismissPolish}>关闭</Button>
              </div>
            </div>
            <div className="max-h-24 overflow-y-auto rounded border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">{polishResult.original}</div>
            <div className="mt-1 max-h-24 overflow-y-auto rounded border border-emerald-200 bg-white p-1.5 dark:bg-slate-900">{polishResult.polished}</div>
            <div className="mt-1 text-slate-500 dark:text-slate-400">{polishResult.reason}</div>
          </div>
        )}
      </section>

      {/* 模拟同行评审 */}
      <section>
        <div className={SEC}>模拟同行评审（3 审稿人 + 主编决定）</div>
        <Button variant="outline" className="text-xs w-full" onClick={onRunReview} disabled={aiBusy}>
          <ClipboardCheck size={12} className="text-teal-600" aria-hidden="true" /> 模拟评审全文
        </Button>
        {reviewResult && !('error' in reviewResult) && (
          <div className="mt-2 space-y-2 text-xs">
            <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-2 dark:border-teal-800 dark:bg-teal-900/20">
              <div className="mb-0.5 font-medium text-teal-700 dark:text-teal-300">主编决定：{reviewResult.verdict}</div>
              <div className="leading-relaxed">{reviewResult.overall}</div>
            </div>
            <HBar
              max={100}
              items={reviewResult.reviewers.map((rv) => ({ label: rv.role, value: rv.score, color: scoreColor(rv.score, 80, 60), hint: rv.concerns.join('；').slice(0, 60) }))}
            />
          </div>
        )}
      </section>

      {/* 审稿意见闭环 */}
      <section>
        <button className={`w-full flex items-center justify-between ${SEC}`} onClick={onToggleComments}>
          <span className="flex items-center gap-1"><MessageSquare size={12} className="text-teal-600" aria-hidden="true" /> 审稿意见闭环</span>
          <span className="text-[11px] text-slate-400">{reviewComments.length > 0 && `${reviewComments.length} 条 · `}{commentsOpen ? '收起 ▾' : '展开 ▸'}</span>
        </button>
        {commentsOpen && (
          <div className="space-y-2 text-xs">
            <div className="flex gap-1.5">
              <Button variant="outline" className="text-xs flex-1" onClick={onGenerateLetter} disabled={aiBusy || generatingLetter || reviewComments.length === 0}>
                {generatingLetter ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} aria-hidden="true" />} 生成回复信
              </Button>
              <Button variant="outline" className="text-xs flex-1" onClick={onImportComments} disabled={aiBusy || importingComments || !reviewResult}>
                {importingComments ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} aria-hidden="true" />} 导入模拟评审
              </Button>
            </div>
            {commentsLoading ? <Spinner /> : reviewComments.length === 0 ? (
              <div className="text-slate-400">暂无审稿意见。</div>
            ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                {reviewComments.map((c) => {
                  const meta = COMMENT_STATUS[c.status] || { label: c.status, tone: 'slate' as const };
                  return (
                    <div key={c.id} className="rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="font-medium">{c.reviewer}</span>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <button className="ml-auto text-slate-300 hover:text-rose-500" title="删除" onClick={() => onRemoveComment(c)}>
                          <Trash2 size={11} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mb-1.5 leading-relaxed">{c.commentText}</div>
                      <div className="mb-1.5 flex gap-1">
                        {(['open', 'resolved', 'deferred'] as const).map((st) => (
                          <button
                            key={st}
                            onClick={() => onChangeCommentStatus(c, st)}
                            className={`rounded px-1.5 py-0.5 text-[11px] ${c.status === st ? 'bubble-user' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}
                          >
                            {COMMENT_STATUS[st].label}
                          </button>
                        ))}
                      </div>
                      {replyId === c.id ? (
                        <div>
                          <Textarea rows={2} placeholder="撰写针对该意见的 point 回复…" value={replyDraft} onChange={(e) => onReplyDraft(e.target.value)} className="mb-1" />
                          <div className="flex gap-1">
                            <Button variant="success" className="px-2 py-0.5 text-xs" onClick={() => onSaveReply(c)} disabled={savingReply}>保存回复</Button>
                            <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={onCancelReply}>取消</Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {c.responseText && <div className="mb-1 rounded bg-teal-50 p-1.5 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300">{c.responseText}</div>}
                          <button className="text-teal-600 underline dark:text-teal-400" onClick={() => onStartReply(c)}>{c.responseText ? '编辑回复' : '回复'}</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {letter && (
              <div className="mt-2">
                <div className="mb-1 font-medium text-teal-700 dark:text-teal-300">Point-by-point 回复信</div>
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/60">{letter}</div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 质量评分 */}
      <section>
        <div className={`${SEC} flex items-center gap-1`}>
          <Gauge size={12} className="text-teal-600" aria-hidden="true" /> 质量评分
          {qualityReport && <span className="text-[11px] text-slate-400">总分 {qualityReport.totalScore}</span>}
        </div>
        {!qualityReport ? (
          <div className="text-xs text-slate-400">暂无评分，可到「质量评分」页运行 7 维评分。</div>
        ) : (
          <HBar max={100} items={Object.entries(qualityScores).map(([k, v]) => ({ label: k, value: Math.round(Number(v) || 0), color: scoreColor(Math.round(Number(v) || 0), 75, 60) }))} />
        )}
      </section>

      {/* 关联实验 */}
      <section>
        <button className={`w-full flex items-center justify-between ${SEC}`} onClick={onToggleExperiments}>
          <span className="flex items-center gap-1"><FlaskConical size={12} className="text-teal-600" aria-hidden="true" /> 关联实验</span>
          <span className="text-[11px] text-slate-400">{docExperiments.length > 0 && `${docExperiments.length} 条 · `}{experimentsOpen ? '收起 ▾' : '展开 ▸'}</span>
        </button>
        {experimentsOpen && (
          <div className="text-xs">
            {docExperiments.length === 0 ? (
              <div className="text-slate-400">暂无关联实验。</div>
            ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                {docExperiments.map((exp) => (
                  <div key={exp.id} className="rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="flex-1 truncate font-medium">{exp.goal || '未命名实验'}</span>
                      <Badge tone={exp.status === 'ok' ? 'green' : exp.status === 'error' ? 'red' : 'amber'}>
                        {exp.status === 'ok' ? '成功' : exp.status === 'error' ? '失败' : '超时'}
                      </Badge>
                    </div>
                    <div className="mb-1 text-[11px] text-slate-400">{(exp.runtimeMs / 1000).toFixed(1)}s · {new Date(exp.createdAt).toLocaleDateString()}</div>
                    {exp.figures?.[0] && <img src={exp.figures[0]} alt="实验结果图" className="mb-1 h-auto w-24 rounded border border-slate-100 dark:border-slate-800" />}
                    {exp.conclusion && <div className="leading-relaxed">{exp.conclusion}</div>}
                    {(exp.conclusion || exp.figures?.[0]) && (
                      <button className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-teal-600 hover:underline dark:text-teal-400" onClick={() => onInsertExperiment(exp)}>
                        <ArrowDownToLine size={11} aria-hidden="true" /> 插入正文
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 版本历史 */}
      <section>
        <button className={`w-full flex items-center justify-between ${SEC}`} onClick={onToggleVersions}>
          <span className="flex items-center gap-1"><History size={12} className="text-teal-600" aria-hidden="true" /> 版本历史</span>
          <span className="text-[11px] text-slate-400">{snapshots.length > 1 && `${snapshots.length} 个快照 · `}{versionsOpen ? '收起 ▾' : '展开 ▸'}</span>
        </button>
        {versionsOpen && (
          <div className="space-y-1.5 text-xs">
            <div className="flex gap-1.5">
              <input
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-teal-500/60 focus:ring-1 focus:ring-teal-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                placeholder="提交信息（可选，如：初稿完成）"
                value={snapshotMsg}
                onChange={(e) => onSnapshotMsg(e.target.value)}
                aria-label="快照提交信息"
              />
              <Button className="shrink-0 text-xs" onClick={onCreateSnapshot} disabled={snapshotBusy} loading={snapshotBusy}>
                <History size={12} aria-hidden="true" /> 创建快照
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              将当前内容固化为不可变版本（可命名、可左右对比、可恢复），区别于自动保存的历史记录。
            </p>
            <Button variant="outline" className="w-full text-xs" onClick={onOpenDiff} disabled={snapshots.length < 2}>
              <History size={12} aria-hidden="true" /> 左右栏对比版本
            </Button>
            {snapshots.length < 2 && <div className="text-slate-400">再保存一次内容变更才会产生可对比的历史快照。</div>}
          </div>
        )}
      </section>
    </div>
  );
}
