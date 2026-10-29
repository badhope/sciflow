import { lazy, Suspense } from 'react';
import { BookOpenCheck, Download, GitCompareArrows, Lightbulb, ListChecks, Loader2, Network, Table2 } from 'lucide-react';
import type { EvidenceResult, ExtractedPaper, PaperComparisonResult, ReferenceGraph, DeepDiveResult, GapResult, Reference } from '../../types';
import { Badge, Button, Empty, Input, Select, Spinner } from '../../components/ui';
import { SegBar } from '../../components/charts';
// 引用网络 = sigma.js + graphology + ForceAtlas2（WebGL，约 450KB）。
// 只在用户切到「引用网络」标签时才下载；否则文献页首屏要多背一个渲染引擎。
const ReferenceNetwork = lazy(() => import('./ForceGraph').then((m) => ({ default: m.ReferenceNetwork })));

export type Tool = 'summary' | 'extract' | 'evidence' | 'deepdive' | 'gap' | 'compare' | 'graph';

export const TOOLS: { key: Tool; label: string; icon: typeof ListChecks; hint: string }[] = [
  { key: 'summary', label: '文献综述', icon: Download, hint: '结构化综述' },
  { key: 'extract', label: '结构化提取', icon: ListChecks, hint: '跨文献对比表' },
  { key: 'evidence', label: '证据综合', icon: GitCompareArrows, hint: '证据共识度' },
  { key: 'deepdive', label: '单篇精读', icon: BookOpenCheck, hint: '论文精读解剖' },
  { key: 'gap', label: '研究缺口', icon: Lightbulb, hint: '科研选题定位' },
  { key: 'compare', label: '文献对比', icon: Table2, hint: '多篇横向对比表' },
  { key: 'graph', label: '引用网络', icon: Network, hint: '共引/去重关系图' },
];

export interface LiteratureToolsProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  busy: string;
  // summary
  summary: string;
  runSummary: () => void;
  query: string;
  hasRefs: boolean;
  projectName: string;
  // extract
  extracted: ExtractedPaper[];
  runExtract: () => void;
  // evidence
  evidence: EvidenceResult | null;
  question: string;
  setQuestion: (v: string) => void;
  runEvidence: () => void;
  consensus: { label: string; value: number; color: string; hint: string }[];
  // deepdive
  deepDive: DeepDiveResult | null;
  deepDiveRef: string;
  setDeepDiveRef: (v: string) => void;
  runDeepDive: () => void;
  refs: Reference[];
  // gap
  gapResult: GapResult | null;
  gapTopic: string;
  setGapTopic: (v: string) => void;
  runGap: () => void;
  // compare
  selectedCount: number;
  comparison: PaperComparisonResult | null;
  runCompare: () => void;
  // graph
  graph: ReferenceGraph | null;
  graphLoading: boolean;
  // stance tone helper
  stanceTone: (s: string) => 'slate' | 'green' | 'amber' | 'red';
}

export function LiteratureTools(props: LiteratureToolsProps) {
  const {
    tool, setTool, busy,
    summary, runSummary, query: _query, hasRefs, projectName: _projectName,
    extracted, runExtract,
    evidence, question, setQuestion, runEvidence, consensus,
    deepDive, deepDiveRef, setDeepDiveRef, runDeepDive, refs,
    gapResult, gapTopic, setGapTopic, runGap,
    selectedCount, comparison, runCompare,
    graph, graphLoading,
    stanceTone,
  } = props;

  // Export tabs bar
  const tabsBar = (
    <div role="tablist" aria-label="文献研究工具" className="flex flex-wrap gap-1 mb-4 border-b border-slate-200 dark:border-slate-800 min-w-0">
      {TOOLS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tool === t.key}
          title={t.hint}
          onClick={() => setTool(t.key)}
          className={`flex items-center gap-1.5 px-2.5 py-2 text-xs border-b-2 -mb-px whitespace-nowrap ${
            tool === t.key ? 'border-teal-600 text-teal-700 dark:text-teal-300 font-medium' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <t.icon size={13} aria-hidden="true" /> {t.label}
        </button>
      ))}
    </div>
  );

  // —— Tool output content ——
  let content: React.ReactNode = null;

  if (tool === 'summary') {
    content = (
      <>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">AI 文献综述</span>
          <Button variant="outline" className="text-xs" onClick={runSummary} disabled={busy === 'summary' || !hasRefs}>
            {busy === 'summary' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 生成
          </Button>
        </div>
        {busy === 'summary' ? (
          <Spinner label="生成综述中…" />
        ) : summary ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 max-h-[440px] overflow-y-auto">{summary}</div>
        ) : (
          <Empty text="基于文献库自动撰写结构化综述：按主题组织 + 每处观点绑定 [Ref:N] 文献 + 研究空白" />
        )}
      </>
    );
  }

  if (tool === 'extract') {
    content = (
      <>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">结构化提取（方法/结果/贡献/局限）</span>
          <Button variant="outline" className="text-xs" onClick={runExtract} disabled={busy === 'extract' || !hasRefs}>
            {busy === 'extract' ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />} 提取
          </Button>
        </div>
        {busy === 'extract' ? (
          <Spinner label="提取文献结构化信息…" />
        ) : extracted.length > 0 ? (
          <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left">文献</th>
                  <th className="px-2 py-2 text-left">方法</th>
                  <th className="px-2 py-2 text-left">结果</th>
                  <th className="px-2 py-2 text-left">贡献</th>
                  <th className="px-2 py-2 text-left">局限</th>
                </tr>
              </thead>
              <tbody>
                {extracted.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800 align-top">
                    <td className="px-2 py-2 max-w-[180px]">
                      <div className="font-medium text-slate-700 dark:text-slate-200 leading-snug">{p.title}</div>
                      <div className="text-slate-400 dark:text-slate-500 mt-0.5">{p.year || 'n.d.'}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{p.method}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{p.results}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{p.contribution}</td>
                    <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{p.limitations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="对文献库做系统综述式结构化提取：方法、关键结果、核心贡献、局限，生成可对比的表格" />
        )}
      </>
    );
  }

  if (tool === 'deepdive') {
    content = (
      <>
        <div className="flex gap-2 mb-3">
          <Select
            className="flex-1 text-xs"
            options={[{ value: '', label: '选择要精读的文献…' }, ...refs.map((r) => ({ value: r.id, label: r.title }))]}
            value={deepDiveRef}
            onChange={(v) => { setDeepDiveRef(v); if (v) runDeepDive(); }}
          />
          <Button variant="outline" className="text-xs shrink-0" onClick={runDeepDive} disabled={busy === 'deepdive' || !deepDiveRef}>
            {busy === 'deepdive' ? <Loader2 size={13} className="animate-spin" /> : <BookOpenCheck size={13} />} 精读
          </Button>
        </div>
        {busy === 'deepdive' ? (
          <Spinner label="AI 深度解读文献…" />
        ) : deepDive ? (
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{deepDive.oneLine}</div>
            <div className="rounded-lg bg-teal-50/50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900 p-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{deepDive.takeaway}</div>
            {[
              ['研究问题', deepDive.researchQuestion],
              ['研究动机', deepDive.motivation],
              ['研究方法', deepDive.method],
            ].map(([label, val]) => (
              <div key={label} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                <div className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-1">{label}</div>
                <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{val}</div>
              </div>
            ))}
            <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-1">关键发现</div>
              <ul className="list-disc pl-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {deepDive.keyFindings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-amber-100 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-900/10 p-3">
              <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">局限</div>
              <ul className="list-disc pl-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {deepDive.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-1">未来工作</div>
              <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{deepDive.futureWork}</div>
            </div>
          </div>
        ) : (
          <Empty text="选择一篇文献，AI 深度解剖：研究问题 / 动机 / 方法 / 关键发现 / 局限 / 未来工作" />
        )}
      </>
    );
  }

  if (tool === 'gap') {
    content = (
      <>
        <div className="flex gap-2 mb-3">
          <Input placeholder="研究主题（留空则用项目名），如：大语言模型评估" value={gapTopic} onChange={(e) => setGapTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runGap()} />
          <Button variant="outline" className="text-xs shrink-0" onClick={runGap} disabled={busy === 'gap' || !hasRefs}>
            {busy === 'gap' ? <Loader2 size={13} className="animate-spin" /> : <Lightbulb size={13} />} 定位缺口
          </Button>
        </div>
        {busy === 'gap' ? (
          <Spinner label="分析研究缺口…" />
        ) : gapResult ? (
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            <div className="rounded-lg bg-teal-50/50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900 p-3">
              <div className="text-xs font-medium text-teal-700 dark:text-teal-300 mb-1">推荐选题</div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{gapResult.recommendedTopic}</div>
            </div>
            {/* 按可行性三栏看板 */}
            <div className="grid md:grid-cols-3 gap-2">
              {(['高', '中', '低'] as const).map((level) => {
                const items = gapResult.gaps.filter((g) => g.feasibility === level);
                const headCls =
                  level === '高'
                    ? 'text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                    : level === '中'
                    ? 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900'
                    : 'text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900';
                return (
                  <div key={level} className="rounded-lg border border-slate-100 dark:border-slate-800 overflow-hidden">
                    <div className={`px-2.5 py-1.5 text-xs font-semibold border-b bg-slate-50/60 dark:bg-slate-900/40 ${headCls}`}>
                      可行性{level} · {items.length}
                    </div>
                    <div className="p-2 space-y-2">
                      {items.length === 0 ? (
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 py-3 text-center">暂无</div>
                      ) : (
                        items.map((g, i) => (
                          <div key={i} className="text-xs rounded-md bg-slate-50 dark:bg-slate-900/40 p-2">
                            <div className="font-medium text-slate-700 dark:text-slate-200 leading-snug">{g.gap}</div>
                            <div className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed"><span className="text-teal-600 dark:text-teal-400">依据：</span>{g.evidence}</div>
                            <div className="text-slate-500 dark:text-slate-400 mt-1 leading-relaxed"><span className="text-teal-600 dark:text-teal-400">切入点：</span>{g.opportunity}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <Empty text="基于文献库定位未被充分研究的子问题（Research Gap），并给出可行选题建议与可行性评估" />
        )}
      </>
    );
  }

  if (tool === 'compare') {
    content = (
      <>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">多文献横向对比（研究问题/方法/结论/局限）</span>
          <Button variant="outline" className="text-xs" onClick={runCompare} disabled={busy === 'compare' || selectedCount < 2}>
            {busy === 'compare' ? <Loader2 size={13} className="animate-spin" /> : <Table2 size={13} />} 生成对比表
          </Button>
        </div>
        {busy === 'compare' ? (
          <Spinner label="AI 横向对比文献…" />
        ) : comparison ? (
          <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <div className="bg-slate-50 dark:bg-slate-900/50 p-3 text-xs text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">{comparison.summary}</div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left">文献</th>
                  <th className="px-2 py-2 text-left">研究问题</th>
                  <th className="px-2 py-2 text-left">方法</th>
                  <th className="px-2 py-2 text-left">主要结论</th>
                  <th className="px-2 py-2 text-left">局限</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800 align-top">
                    <td className="px-2 py-2 max-w-[150px] font-medium text-slate-700 dark:text-slate-200">{r.paper}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.研究问题}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.方法}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.主要结论}</td>
                    <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{r.局限}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="勾选左侧文献库 2 篇以上文献（复选框），AI 生成研究问题 / 方法 / 结论 / 局限的横向对比表" />
        )}
      </>
    );
  }

  if (tool === 'evidence') {
    content = (
      <>
        <div className="flex gap-2 mb-3">
          <Input placeholder="输入研究问题，如：大语言模型能否有效评测？" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runEvidence()} />
          <Button variant="outline" className="text-xs shrink-0" onClick={runEvidence} disabled={busy === 'evidence' || !question.trim() || !hasRefs}>
            {busy === 'evidence' ? <Loader2 size={13} className="animate-spin" /> : <GitCompareArrows size={13} />} 综合证据
          </Button>
        </div>
        {busy === 'evidence' ? (
          <Spinner label="综合证据中…" />
        ) : evidence ? (
          <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
            {consensus.length > 0 && (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 p-3">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">共识度概览（按 stance 归类文献计数）</div>
                <SegBar segments={consensus} />
              </div>
            )}
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{evidence.summary}</div>
            {evidence.stances.map((s, i) => (
              <div key={i} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.claim}</div>
                  <Badge tone={stanceTone(s.stance)}>{s.stance} · {s.count} 篇</Badge>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s.note}</div>
                {s.refs.length > 0 && <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">依据：[Ref:{s.refs.join(', ')}]</div>}
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Consensus 式证据综合：判断每个论断的证据强度（支持/部分支持/矛盾/证据不足）并统计文献数" />
        )}
      </>
    );
  }

  if (tool === 'graph') {
    content = (
      <>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Network size={14} /> 引用网络（共引 + 去重）
          </span>
          <span className="text-[11px] text-slate-400">拖拽节点 · 点击选中 · 点空白取消</span>
        </div>
        {graphLoading ? (
          <Spinner label="聚合引用网络中…" />
        ) : !graph || graph.nodes.length === 0 ? (
          <Empty text="暂无文献，先去文献调研页录入 / 导入 BibTeX；网络将按文档共引与去重关系自动布局" />
        ) : (
          <Suspense fallback={<Spinner label="加载引用网络引擎…" />}>
            <ReferenceNetwork
              graph={graph}
              onViewRef={() => setTool('summary')}
            />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <>
      {tabsBar}
      {content}
    </>
  );
}
