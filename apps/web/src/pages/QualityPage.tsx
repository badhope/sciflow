import { useEffect, useMemo, useState, useContext } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, LayoutList, Loader2, ShieldCheck, Sparkles, ListChecks } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Project, QualityReport, CitationAudit, ObjectiveQualityReport, ProjectQualityOverview } from '../types';
import { Badge, Button, Card, EmptyState, ErrorBox, Select, Spinner, jsonText, errMsg } from '../components/ui';
import { ToastContext } from '../App';
import { HBar, LineChart, ProgressRing } from '../components/charts';
import { QUALITY_DIMS } from './qualityDims';

/** LLM 参考分：新报告读 llmScore；拆分前老数据回落到 totalScore（那时 totalScore 存的就是 LLM 分） */
function llmScoreOf(r: QualityReport): number {
  return typeof r.llmScore === 'number' ? r.llmScore : r.totalScore;
}

/** 雷达图/维度条用的 LLM 分项：优先 llmScores，老数据回落 scores */
function llmScoresOf(r: QualityReport): Record<string, number> {
  const explicit = r.llmScores ? jsonText<Record<string, number>>(r.llmScores, {}) : {};
  return Object.keys(explicit).length ? explicit : jsonText<Record<string, number>>(r.scores, {});
}

/** 自绘 SVG 雷达图（替代 ECharts，去掉 ~200KB 打包体积） */
function Radar({ scores, compare }: { scores: Record<string, number>; compare?: Record<string, number> | null }) {
  const W = 300, H = 250, CX = W / 2, CY = 112, R = 82;
  const n = QUALITY_DIMS.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, v: number) => {
    const r = (v / 100) * R;
    return [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))] as const;
  };
  const poly = (v: number) => Array.from({ length: n }, (_, i) => pt(i, v).join(',')).join(' ');
  const value = (i: number) => Math.round(scores[QUALITY_DIMS[i].key] ?? 0);
  /** 数据多边形：按各维真实分数取点（历史 bug：写死 poly(100)，任何稿子都画成满分形状） */
  const dataPoly = Array.from({ length: n }, (_, i) => pt(i, value(i)).join(',')).join(' ');
  const total = Math.round(QUALITY_DIMS.reduce((s, _, i) => s + value(i), 0) / n);
  /** 对比层（F-2.5）：上一版评分的多边形，与当前版同图叠加 */
  const compareValue = (i: number) => Math.round(compare?.[QUALITY_DIMS[i].key] ?? 0);
  const comparePoly = compare
    ? Array.from({ length: n }, (_, i) => pt(i, compareValue(i)).join(',')).join(' ')
    : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`7 维质量评分雷达图，平均 ${total} 分`}>
      <desc>
        {QUALITY_DIMS.map((d, i) => `${d.label} ${value(i)} 分`).join('；')}
        {compare ? `。对比版本：${QUALITY_DIMS.map((d, i) => `${d.label} ${compareValue(i)} 分`).join('；')}` : ''}
      </desc>
      {/* 网格：4 级同心多边形 */}
      {[25, 50, 75, 100].map((lv) => (
        <polygon key={lv} points={poly(lv)} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth="1" />
      ))}
      {/* 轴线 */}
      {QUALITY_DIMS.map((_, i) => (
        <line key={i} x1={CX} y1={CY} x2={pt(i, 100)[0]} y2={pt(i, 100)[1]} stroke="currentColor" strokeOpacity={0.14} strokeWidth="1" />
      ))}
      {/* 对比层：上一版评分（虚线灰色，不抢主线视觉） */}
      {compare && (
        <polygon points={comparePoly} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.4} strokeDasharray="4 3" strokeOpacity={0.8} />
      )}
      {/* 数据多边形（真实分数） */}
      <polygon points={dataPoly} fill="var(--brand-500)" fillOpacity={0.22} stroke="var(--brand-500)" strokeWidth="2" strokeLinejoin="round" />
      {/* 顶点 + 数值标签 */}
      {QUALITY_DIMS.map((d, i) => {
        const [x, y] = pt(i, value(i));
        const [lx, ly] = pt(i, 118);
        return (
          <g key={d.key}>
            <circle cx={x} cy={y} r="3.5" fill="var(--brand-400)" stroke="var(--background)" strokeWidth="1.5">
              <title>{`${d.label}：${value(i)}/100`}</title>
            </circle>
            <text x={lx} y={ly} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity={0.62} fontWeight={600}>
              {d.label}
            </text>
            <text x={lx} y={ly + 11} textAnchor="middle" fontSize="10" fill="var(--brand-500)" fontWeight={700}>
              {value(i)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function QualityPage({ project }: { project: Project }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState<string>('');
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<(QualityReport & { scoresObj: Record<string, number> }) | null>(null);
  const [history, setHistory] = useState<QualityReport[]>([]);
  const [selectedHist, setSelectedHist] = useState<(QualityReport & { scoresObj: Record<string, number> }) | null>(null);
  /** 差距#7：把改进建议拆为可勾选待办（写入 review_comment）的导出态 */
  const [exporting, setExporting] = useState(false);
  /** B-4.3 引用体检：锚点×落库交叉审计结果 */
  const [audit, setAudit] = useState<CitationAudit | null>(null);
  const [auditing, setAuditing] = useState(false);
  /**
   * 客观检查器（v1.8）：确定性六维硬指标。
   *
   * 为什么质量页必须给它一块位置：本页此前只有「LLM 7 维」，而流水线门禁用的是
   * 客观分（同一稿 LLM 在 27–59 漂移）。用户在这里点「开始评分」看到的分数
   * 与流水线判定的分数不是一回事，导致「页面 62 分却过闸」的认知冲突。
   * 现在两套分数并排展示：客观分（可复现、可核对指纹）+ LLM 分（仅参考）。
   */
  const [objective, setObjective] = useState<{ docId: string; report: ObjectiveQualityReport } | null>(null);
  const [objectiveError, setObjectiveError] = useState('');
  /** 项目内全部文档最新分总览（v1.8）：进入页面即出「哪几篇没达标」 */
  const [overview, setOverview] = useState<ProjectQualityOverview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const toast = useContext(ToastContext);

  /**
   * 总览列表的前端兜底排序：最差优先，同分按更新时间倒序。
   * 后端已排过，但 UI 不应依赖接口顺序——否则接口一改顺序，「最需回炉的」就会沉底。
   */
  const overviewSorted = useMemo(() => {
    if (!overview) return [];
    return [...overview.items].sort(
      (a, b) => a.objectiveScore - b.objectiveScore || b.updatedAt - a.updatedAt,
    );
  }, [overview]);

  const runAudit = async () => {
    if (!docId) return;
    setAuditing(true);
    try {
      setAudit(await api.documents.citationAudit(docId));
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setAuditing(false);
    }
  };

  /**
   * 加载文档列表与总览。
   * 默认选中最新一篇：docs 按 updatedAt 升序，docs[0] 是最旧的——与 WorkspacePage /
   * WritingPage 同类 bug（那两处已修，本页漏了），会导致刚改完的稿子不在默认选中里。
   */
  useEffect(() => {
    let cancelled = false;
    api.documents.list(project.id).then((d) => {
      if (cancelled) return;
      setDocs(d);
      if (d.length) setDocId(d[d.length - 1].id);
    });
    api.quality
      .projectOverview(project.id)
      .then((o) => { if (!cancelled) { setOverview(o); setOverviewError(''); } })
      .catch((e: unknown) => { if (!cancelled) setOverviewError(errMsg(e)); });
    return () => { cancelled = true; };
  }, [project.id]);

  /** 切换文档时立即拉客观检查（纯本地规则，无模型成本，无需用户点按钮） */
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    api.documents
      .objectiveAudit(docId)
      .then((r) => {
        if (cancelled) return;
        setObjective({ docId, report: r.report });
        setObjectiveError('');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setObjectiveError(errMsg(e));
      });
    return () => { cancelled = true; };
  }, [docId]);

  /**
   * 「检查中」由「当前文档 ≠ 报告所属文档」派生，而不是 effect 里 setState：
   * effect 内同步 setState 会触发级联渲染（react-hooks/set-state-in-effect 拦截）。
   */
  const objectiveLoading = Boolean(docId) && objective?.docId !== docId && !objectiveError;

  useEffect(() => {
    if (docId)
      api.quality
        .history(docId)
        .then((h) => {
          setHistory(h);
          if (h.length) setSelectedHist({ ...h[0], scoresObj: llmScoresOf(h[0]) });
        })
        .catch(() => setHistory([]));
  }, [docId]);

  const doReview = async () => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;
    setScoring(true);
    setError('');
    try {
      const r = await api.quality.review(doc.id, doc.title, doc.content);
      const full = { ...r, scoresObj: llmScoresOf(r) };
      setReport(full);
      setSelectedHist(full);
      setHistory(await api.quality.history(doc.id));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setScoring(false);
    }
  };

  /** 差距#7：把最新 quality_report.feedback 按句拆成 review_comment 待办（幂等），供写作页/投稿页复用 */
  const doExportComments = async () => {
    if (!docId || exporting) return;
    setExporting(true);
    setError('');
    try {
      const res = await api.quality.exportComments(docId);
      if (res.created > 0) toast('success', `已拆出 ${res.created} 条改进待办（写入审稿意见表，写作/投稿页可见）`);
      else toast('info', `无新增：已有 ${res.existing} 条待办，未重复创建`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  const current = selectedHist || report;
  /**
   * 对比基准（F-2.5）：
   *  - 未选历史版本时，显示「当前最新」与「上一版」的叠加（若存在两次以上评分）
   *  - 选中历史版本时，改为「所选版本」与「最新版本」对比
   */
  const compareReport = (() => {
    if (!current) return null;
    // history 按 createdAt 倒序：h[0] 是最新。若当前展示的就是最新一条，
    // 对比基准取第二条；否则（用户在查看历史版本）对比基准取最新一条。
    const latest = history[0];
    if (!latest) return null;
    if (current.id === latest.id) return history[1] ?? null;
    return latest;
  })();

  return (
    <div className="page-container">
      <ErrorBox message={error} />

      {/* 全部文档最新分（v1.8）：进页先回答「哪几篇没达标」，再决定点哪篇细看 */}
      {overview && overview.total > 0 && (
        <Card tone="inset" className="mb-4 p-4" id="quality-overview">
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <LayoutList size={15} className="text-teal-600 dark:text-teal-300" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">全部文档最新分</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">按客观分从低到高（最需回炉的在前）</span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px]">
              <Badge tone="green">达标 {overview.passed}</Badge>
              <Badge tone={overview.failed > 0 ? 'red' : 'slate'}>未达标 {overview.failed}</Badge>
              {overview.unscored > 0 && <Badge tone="amber">空文 {overview.unscored}</Badge>}
            </span>
          </div>
          <div className="space-y-1.5">
            {overviewSorted.map((it) => (
              <button
                key={it.documentId}
                type="button"
                onClick={() => setDocId(it.documentId)}
                aria-current={it.documentId === docId ? 'true' : undefined}
                title={it.hardFails.length ? it.hardFails.join('；') : undefined}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                  it.documentId === docId
                    ? 'border-teal-400 bg-teal-50/70 dark:border-teal-600 dark:bg-teal-900/20'
                    : 'border-slate-100 hover:border-teal-300 dark:border-slate-800'
                }`}
              >
                <span className={`w-11 shrink-0 text-right font-semibold tabular-nums ${
                  it.passed ? 'text-emerald-600 dark:text-emerald-400'
                    : it.chars === 0 ? 'text-slate-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}>
                  {it.chars === 0 ? '—' : it.objectiveScore}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{it.title}</span>
                {it.hardFailCount > 0 && <Badge tone="red">硬伤 {it.hardFailCount}</Badge>}
                <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                  {it.llmScore == null ? 'LLM 未评' : `LLM ${it.llmScore}`}
                </span>
                <span className="w-16 shrink-0 text-right text-[11px] text-slate-400 dark:text-slate-500">
                  {it.chars.toLocaleString()} 字
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            左列分数是<span className="font-medium">客观分</span>（对当前正文实时计算，流水线门禁用它）；
            右侧是最近一次 <span className="font-medium">LLM 评分</span>（历史值，仅供参考，同一稿会漂移）。
          </p>
          {overviewError && <div className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">{overviewError}</div>}
        </Card>
      )}

      <Card tone="accent" className="mb-4 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Gauge size={16} className="text-teal-600 dark:text-teal-300" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 mr-2">选择文档进行 7 维质量评分</span>
          <Select
            className="w-full sm:w-64"
            options={[{ value: '', label: '选择文档…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
            value={docId}
            onChange={(v: string) => { setDocId(v); setAudit(null); setReport(null); setSelectedHist(null); setObjective(null); }}
          />
          <Button onClick={doReview} disabled={scoring || !docId} aria-busy={scoring}>
            {scoring ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />} {scoring ? '评分中…' : '开始评分'}
          </Button>
          <Button onClick={runAudit} disabled={auditing || !docId} aria-busy={auditing} variant="outline">
            {auditing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ListChecks size={15} aria-hidden="true" />} {auditing ? '体检中…' : '引用体检'}
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-2">
          七维：文献充分性 · 逻辑一致性 · 引用规范 · 语言质量 · 创新性 · 图表 · 格式（0-100，总分取均值），结果持久化可历史对比
        </div>
      </Card>
      {/* 客观检查器：与 LLM 分并排的确定性依据（切换文档即自动出分，零模型成本） */}
      <Card tone="metric" className="p-4 mb-4" id="objective-audit">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <ShieldCheck size={16} className="text-teal-600 dark:text-teal-300" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">客观检查器（确定性）</span>
          {objective && (
            <Badge tone={objective.report.totalScore >= (objective.report.standard?.passScore ?? 80) ? 'green' : objective.report.totalScore >= 60 ? 'amber' : 'red'}>
              {objective.report.totalScore}/100
            </Badge>
          )}
          {objective && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              指纹 {objective.report.fingerprint} · 同一正文必然同分
            </span>
          )}
          {objective?.report.standard && (
            <Badge tone="teal">
              标准：{objective.report.standard.label} · {objective.report.standard.passScore} 分及格
            </Badge>
          )}
          <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">流水线质量门用的就是这个分</span>
        </div>

        {objectiveLoading && !objective ? (
          <div className="py-6 flex justify-center"><Spinner label="检查中…" /></div>
        ) : objectiveError ? (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" role="alert">
            客观检查失败：{objectiveError}
          </div>
        ) : objective && objective.docId === docId ? (
          <>
            {/* 七个维度：lg 一行七列；sm 4+3 两行——避免 6 列网格下第 7 项孤行（v1.9.4 新增信息密度维后失衡） */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
              {objective.report.dimensions.map((d) => (
                <div key={d.key} className="rounded-lg border border-slate-100 px-2.5 py-2 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{d.label}</div>
                  <div className={`text-base font-semibold tabular-nums ${
                    d.score >= 16 ? 'text-emerald-600 dark:text-emerald-400'
                      : d.score >= 12 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {d.score}<span className="text-[11px] font-normal text-slate-400">/20</span>
                  </div>
                </div>
              ))}
            </div>

            {objective.report.hardFails.length > 0 ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/30">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
                  <AlertTriangle size={13} aria-hidden="true" /> 硬伤 {objective.report.hardFails.length} 项
                  {/* 封顶口径与检查器一致：空文/过短直接 0，其余硬伤封顶 40 —— 此前统一写「封顶 40」，
                      遇到空文（0 分）会自相矛盾 */}
                  <span className="font-normal">
                    （{objective.report.totalScore === 0 ? '空文/过短直接 0 分' : '总分封顶 40'}）
                  </span>
                </div>
                <ul className="space-y-0.5 text-[11px] text-rose-700 dark:text-rose-300">
                  {objective.report.hardFails.map((f, i) => <li key={i}>· {f}</li>)}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={13} aria-hidden="true" /> 未发现硬伤（占位符 / 空文 / 重复段落 / 长篇零引用 / 名实不符）
              </div>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                统计明细（{objective.report.stats.chars} 字符 · {objective.report.stats.sections} 章 · {objective.report.stats.uniqueCitations} 个引用锚点）
              </summary>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span>中文字符 {objective.report.stats.cjkChars}</span>
                <span>英文词 {objective.report.stats.englishWords}</span>
                <span>段落 {objective.report.stats.paragraphs}</span>
                <span>句子 {objective.report.stats.sentences}</span>
                <span>平均句长 {objective.report.stats.avgSentenceChars}</span>
                <span>参考文献条目 {objective.report.stats.referenceEntries}</span>
                <span>重复段落 {objective.report.stats.duplicateParagraphs}</span>
                <span>占位符命中 {objective.report.stats.placeholderHits}</span>
              </div>
            </details>
          </>
        ) : (
          <div className="text-xs text-slate-400 dark:text-slate-500">选择文档后自动检查（纯规则，无模型调用）。</div>
        )}
      </Card>

      {audit && (
        <Card tone="inset" className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks size={16} aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">引用体检</span>
            <Badge tone={audit.score >= 80 ? 'green' : audit.score >= 50 ? 'amber' : 'red'}>{audit.score}/100</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs mb-2">
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900">锚点 {audit.anchorTotal}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900">落库 {audit.citationRows}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900 text-rose-600 dark:text-rose-400">幽灵 {audit.ghost}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900 text-amber-600 dark:text-amber-400">无 DOI {audit.noDoi}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900 text-amber-600 dark:text-amber-400">未引用 {audit.uncitedCount ?? 0}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900 text-amber-600 dark:text-amber-400">重复 DOI {audit.duplicateDoi?.length ?? 0}</div>
          </div>
          {!!audit.missingAnchors?.length && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-1">锚点断号：{audit.missingAnchors.slice(0, 20).join(', ')}{audit.missingAnchors.length > 20 ? ' …' : ''}</p>
          )}
          <ul className="text-xs space-y-1">
            {(audit.details?.length ? audit.details : audit.issues.map((message) => ({ level: 'info' as const, message }))).map((it, i) => (
              <li
                key={i}
                className={
                  it.level === 'red'
                    ? 'text-rose-600 dark:text-rose-400'
                    : it.level === 'yellow'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-600 dark:text-slate-300'
                }
              >
                · {it.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {current ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <ProgressRing value={llmScoreOf(current)} size={54} thickness={6} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">LLM 参考评分</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">{new Date(current.createdAt).toLocaleString()} · 不参与门禁</div>
              </div>
              <div className="ml-auto">
                <Badge tone={llmScoreOf(current) >= 80 ? 'green' : llmScoreOf(current) >= 60 ? 'amber' : 'red'}>
                  LLM {llmScoreOf(current)}/100
                </Badge>
              </div>
            </div>
            <Radar
              scores={current.scoresObj}
              compare={compareReport ? llmScoresOf(compareReport) : null}
            />
            {compareReport && (
              <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3" style={{ background: 'var(--brand-500)' }} /> 当前 {llmScoreOf(current)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 border-t border-dashed" style={{ borderColor: 'var(--muted-foreground)' }} />
                  对比 {llmScoreOf(compareReport)}（{new Date(compareReport.createdAt).toLocaleDateString()}）
                </span>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">最需改进的维度</div>
              <HBar
                max={100}
                items={[...QUALITY_DIMS]
                  .map((d) => ({ label: d.label, value: Math.round(current.scoresObj[d.key] ?? 0) }))
                  .sort((a, b) => a.value - b.value)
                  .slice(0, 3)
                  .map((it) => ({ ...it, color: it.value < 60 ? 'var(--rose-500)' : it.value < 75 ? 'var(--amber-500)' : 'var(--brand-500)' }))}
              />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">改进建议</div>
              <Button
                variant="outline"
                className="text-xs"
                disabled={exporting || !current.feedback}
                onClick={doExportComments}
                title="把上方改进建议按句拆成可勾选待办，写入审稿意见表（写作页/投稿页复用）"
                aria-busy={exporting}
              >
                {exporting ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <ListChecks size={13} aria-hidden="true" />} {exporting ? '导出中…' : '拆为待办清单'}
              </Button>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
              {current.feedback || '暂无反馈'}
            </div>
            {history.length > 1 && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">LLM 参考分趋势（点击数据点可对比）</div>
                <LineChart
                  points={[...history]
                    .reverse()
                    .map((h) => ({ label: `${new Date(h.createdAt).getMonth() + 1}/${new Date(h.createdAt).getDate()}`, value: llmScoreOf(h) }))}
                  height={130}
                  onPointClick={(i) => {
                    const h = [...history].reverse()[i];
                    if (h) setSelectedHist({ ...h, scoresObj: llmScoresOf(h) });
                  }}
                />
                <div className="mt-2 space-y-1">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      className={`w-full text-left text-xs rounded px-2 py-1.5 border ${
                        selectedHist?.id === h.id ? 'border-teal-400 bg-teal-50 dark:bg-teal-500/10' : 'border-slate-100 dark:border-slate-800 hover:border-teal-300'
                      }`}
                      onClick={() => setSelectedHist({ ...h, scoresObj: llmScoresOf(h) })}
                    >
                      {new Date(h.createdAt).toLocaleString()} · LLM 参考 {llmScoreOf(h)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      ) : (
          <EmptyState
            illustration="documents"
            title="选择一篇文档并开始评分"
            hint="评分后这里会显示 7 维雷达图、总分趋势与可执行的改进建议"
            action={
              <Button onClick={doReview} disabled={!docId || scoring} loading={scoring}>
                开始评分
              </Button>
            }
          />
      )}
    </div>
  );
}
