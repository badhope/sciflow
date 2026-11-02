import { useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project, Reference, DiscoveredReference, EvidenceResult, ExtractedPaper, DeepDiveResult, GapResult, PaperComparisonResult, ReferenceGraph, ExtractionField, ExtractionTableResult, ScreeningItem } from '../types';
import { Card, errMsg } from '../components/ui';
import { api } from '../api/client';
import { ToastContext } from '../App';
import { LiteratureTools, Tool } from './literature/LiteratureTools';
import { LiteratureTable } from './literature/LiteratureTable';

export function LiteraturePage({ project }: { project: Project }) {
  const toast = useContext(ToastContext);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<(Reference | DiscoveredReference)[]>([]);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>('summary');
  const [summary, setSummary] = useState('');
  const [extracted, setExtracted] = useState<ExtractedPaper[]>([]);
  const [evidence, setEvidence] = useState<EvidenceResult | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deepDive, setDeepDive] = useState<DeepDiveResult | null>(null);
  const [deepDiveRef, setDeepDiveRef] = useState('');
  const [gapResult, setGapResult] = useState<GapResult | null>(null);
  const [gapTopic, setGapTopic] = useState('');
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<PaperComparisonResult | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [screenItems, setScreenItems] = useState<ScreeningItem[]>([]);
  const [extFields, setExtFields] = useState<ExtractionField[]>([]);
  const [extTable, setExtTable] = useState<ExtractionTableResult | null>(null);
  const [showExtraction, setShowExtraction] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [bibText, setBibText] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    api.references.list(project.id).then(setRefs).catch((e: unknown) => setError(errMsg(e)));
  }, [project.id]);

  useEffect(() => {
    api.references.screenList(project.id).then(setScreenItems).catch((e: unknown) => { setScreenItems([]); setError(errMsg(e)); });
  }, [project.id]);

  // 引用网络（React Query）：切到图谱页时拉取；子组件写回走 setQueryData（保持局部演进能力）
  const qc = useQueryClient();
  const graphQuery = useQuery({
    queryKey: ['ref-graph', project.id],
    queryFn: () => api.references.graph(project.id),
    enabled: tool === 'graph',
  });
  const graph: ReferenceGraph | null = graphQuery.data ?? null;
  const graphLoading = graphQuery.isFetching;
  const setGraph = (g: ReferenceGraph | null) => qc.setQueryData(['ref-graph', project.id], g);
  const setGraphLoading = (_: boolean) => undefined;

  const runSummary = async () => {
    setBusy('summary');
    setError('');
    try {
      setSummary(await api.references.summarize(project.id, query || project.name));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const runExtract = async () => {
    setBusy('extract');
    setError('');
    try {
      setExtracted(await api.references.extract(project.id));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const runEvidence = async () => {
    if (!question.trim()) return;
    setBusy('evidence');
    setError('');
    try {
      setEvidence(await api.references.evidence(project.id, question.trim()));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const runDeepDive = async (refId?: string) => {
    const id = refId || deepDiveRef;
    if (!id) {
      setError('请先选择要精读的文献');
      return;
    }
    setBusy('deepdive');
    setError('');
    try {
      setDeepDive(await api.references.deepDive(project.id, id));
      toast('success', '文献精读完成');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const runGap = async () => {
    setBusy('gap');
    setError('');
    try {
      setGapResult(await api.references.gap(project.id, gapTopic.trim() || project.name));
      toast('success', '研究缺口分析完成');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const runCompare = async () => {
    const chosen = refs.filter((r) => selectedRefs.has(r.id));
    if (chosen.length < 2) {
      setError('请至少选择两篇文献进行对比');
      return;
    }
    setBusy('compare');
    setError('');
    try {
      setComparison(await api.research.comparison(chosen.map((r) => ({ title: r.title, year: r.year, venue: r.venue, abstract: r.abstract || '' }))));
      toast('success', '文献对比完成');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const consensus = useMemo(() => {
    if (!evidence) return [];
    const buckets = { support: 0, partial: 0, conflict: 0, neutral: 0 };
    evidence.stances.forEach((s) => {
      if (s.stance.includes('支持') && !s.stance.includes('部分')) buckets.support += s.count;
      else if (s.stance.includes('矛盾')) buckets.conflict += s.count;
      else if (s.stance.includes('部分')) buckets.partial += s.count;
      else buckets.neutral += s.count;
    });
    return [
      { label: '支持', value: buckets.support, color: 'var(--emerald-500)', hint: `证据支持该论断的文献 ${buckets.support} 篇` },
      { label: '部分支持', value: buckets.partial, color: 'var(--amber-500)', hint: `部分支持 / 有条件支持 ${buckets.partial} 篇` },
      { label: '矛盾', value: buckets.conflict, color: 'var(--rose-500)', hint: `文献结论相互矛盾 ${buckets.conflict} 篇` },
      { label: '中立/不足', value: buckets.neutral, color: 'var(--viz-series-6)', hint: `证据不足或中立 ${buckets.neutral} 篇` },
    ].filter((s) => s.value > 0);
  }, [evidence]);

  const stanceTone = (s: string) =>
    s.includes('支持') && !s.includes('部分') ? 'green' as const :
    s.includes('矛盾') ? 'red' as const :
    s.includes('部分') ? 'amber' as const :
    'slate' as const;

  const hasRefs = refs.length > 0;

  return (
    <div className="page-container min-w-0">
      {/* min-w-0：网格子项默认 min-width:auto，窄屏下会被 828px 的卡片内容撑破并裁切（390 实测） */}
      <div className="grid lg:grid-cols-2 gap-4 min-w-0 items-start [&>*]:min-w-0">
        {/* Left column: search + library list + screening queue + extraction table */}
        <LiteratureTable
          project={project}
          refs={refs}
          setRefs={setRefs}
          hits={hits}
          setHits={setHits}
          searching={searching}
          setSearching={setSearching}
          query={query}
          setQuery={setQuery}
          imported={imported}
          setImported={setImported}
          selectedRefs={selectedRefs}
          setSelectedRefs={setSelectedRefs}
          tool={tool}
          setTool={setTool}
          screenItems={screenItems}
          setScreenItems={setScreenItems}
          extFields={extFields}
          setExtFields={setExtFields}
          extTable={extTable}
          setExtTable={setExtTable}
          showExtraction={showExtraction}
          setShowExtraction={setShowExtraction}
          showImport={showImport}
          setShowImport={setShowImport}
          bibText={bibText}
          setBibText={setBibText}
          importing={importing}
          setImporting={setImporting}
          showAdd={showAdd}
          setShowAdd={setShowAdd}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          setSummary={setSummary}
          setExtracted={setExtracted}
          setEvidence={setEvidence}
          question={question}
          setQuestion={setQuestion}
          setDeepDive={setDeepDive}
          deepDiveRef={deepDiveRef}
          setDeepDiveRef={setDeepDiveRef}
          setGapResult={setGapResult}
          gapTopic={gapTopic}
          setGapTopic={setGapTopic}
          setComparison={setComparison}
          setGraph={setGraph}
          setGraphLoading={setGraphLoading}
          summary={summary}
          extracted={extracted}
          evidence={evidence}
          deepDive={deepDive}
          gapResult={gapResult}
          comparison={comparison}
          graph={graph}
          graphLoading={graphLoading}
        />

        {/* Right column: AI research tools panel */}
        <Card className="p-4 self-start">
          <LiteratureTools
            tool={tool}
            setTool={setTool}
            busy={busy}
            summary={summary}
            runSummary={runSummary}
            query={query}
            hasRefs={hasRefs}
            projectName={project.name}
            extracted={extracted}
            runExtract={runExtract}
            evidence={evidence}
            question={question}
            setQuestion={setQuestion}
            runEvidence={runEvidence}
            consensus={consensus}
            deepDive={deepDive}
            deepDiveRef={deepDiveRef}
            setDeepDiveRef={setDeepDiveRef}
            runDeepDive={runDeepDive}
            refs={refs}
            gapResult={gapResult}
            gapTopic={gapTopic}
            setGapTopic={setGapTopic}
            runGap={runGap}
            selectedCount={selectedRefs.size}
            comparison={comparison}
            runCompare={runCompare}
            graph={graph}
            graphLoading={graphLoading}
            stanceTone={stanceTone}
          />
        </Card>
      </div>
    </div>
  );
}
