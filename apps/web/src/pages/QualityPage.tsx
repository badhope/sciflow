import { useEffect, useState, useContext } from 'react';
import { Gauge, Loader2, Sparkles, ListChecks } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, Project, QualityReport, CitationAudit } from '../types';
import { Badge, Button, Card, EmptyState, ErrorBox, Select, jsonText, errMsg } from '../components/ui';
import { ToastContext } from '../App';
import { HBar, LineChart, ProgressRing } from '../components/charts';
import { QUALITY_DIMS } from './qualityDims';

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
  const toast = useContext(ToastContext);

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

  useEffect(() => {
    api.documents.list(project.id).then((d) => {
      setDocs(d);
      if (d.length) setDocId(d[0].id);
    });
  }, [project.id]);

  useEffect(() => {
    if (docId)
      api.quality
        .history(docId)
        .then((h) => {
          setHistory(h);
          if (h.length) setSelectedHist({ ...h[0], scoresObj: jsonText<Record<string, number>>(h[0].scores, {}) });
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
      const full = { ...r, scoresObj: jsonText<Record<string, number>>(r.scores, {}) };
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

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Gauge size={16} className="text-teal-600 dark:text-teal-300" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 mr-2">选择文档进行 7 维质量评分</span>
          <Select
            className="w-full sm:w-64"
            options={[{ value: '', label: '选择文档…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
            value={docId}
            onChange={(v: string) => { setDocId(v); setAudit(null); setReport(null); setSelectedHist(null); }}
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
      {audit && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks size={16} aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">引用体检</span>
            <Badge tone={audit.score >= 80 ? 'green' : audit.score >= 50 ? 'amber' : 'red'}>{audit.score}/100</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900">锚点 {audit.anchorTotal}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900">落库 {audit.citationRows}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900 text-rose-600 dark:text-rose-400">幽灵 {audit.ghost}</div>
            <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900 text-amber-600 dark:text-amber-400">无 DOI {audit.noDoi}</div>
          </div>
          <ul className="text-xs space-y-1">
            {audit.issues.map((it: string, i: number) => <li key={i} className="text-slate-600 dark:text-slate-300">· {it}</li>)}
          </ul>
        </Card>
      )}

      {current ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <ProgressRing value={current.totalScore} size={54} thickness={6} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">当前评分</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">{new Date(current.createdAt).toLocaleString()}</div>
              </div>
              <div className="ml-auto">
                <Badge tone={current.totalScore >= 80 ? 'green' : current.totalScore >= 60 ? 'amber' : 'red'}>
                  总分 {current.totalScore}/100
                </Badge>
              </div>
            </div>
            <Radar
              scores={current.scoresObj}
              compare={compareReport ? jsonText<Record<string, number>>(compareReport.scores, {}) : null}
            />
            {compareReport && (
              <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3" style={{ background: 'var(--brand-500)' }} /> 当前 {current.totalScore}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 border-t border-dashed" style={{ borderColor: 'var(--muted-foreground)' }} />
                  对比 {compareReport.totalScore}（{new Date(compareReport.createdAt).toLocaleDateString()}）
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
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">总分趋势（点击数据点可对比）</div>
                <LineChart
                  points={[...history]
                    .reverse()
                    .map((h) => ({ label: `${new Date(h.createdAt).getMonth() + 1}/${new Date(h.createdAt).getDate()}`, value: h.totalScore }))}
                  height={130}
                  onPointClick={(i) => {
                    const h = [...history].reverse()[i];
                    if (h) setSelectedHist({ ...h, scoresObj: jsonText<Record<string, number>>(h.scores, {}) });
                  }}
                />
                <div className="mt-2 space-y-1">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      className={`w-full text-left text-xs rounded px-2 py-1.5 border ${
                        selectedHist?.id === h.id ? 'border-teal-400 bg-teal-50 dark:bg-teal-500/10' : 'border-slate-100 dark:border-slate-800 hover:border-teal-300'
                      }`}
                      onClick={() => setSelectedHist({ ...h, scoresObj: jsonText<Record<string, number>>(h.scores, {}) })}
                    >
                      {new Date(h.createdAt).toLocaleString()} · 总分 {h.totalScore}
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
