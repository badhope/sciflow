import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, Brain, Check, ChevronDown, ChevronUp, FileText, Link2, Loader2, MessageSquare, Quote, ScatterChart, Trash2, Unlink, Upload } from 'lucide-react';
import { api } from '../api/client';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { Doc, KnowledgeDoc, KnowledgeDocDetail, KnowledgeQueryResult, KnowledgeSource, Project, Reference } from '../types';
import { Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, SectionTitle, Badge, Spinner, errMsg } from '../components/ui';
import { Donut, HBar } from '../components/charts';
import { SemanticMap } from './knowledge/SemanticMap';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* =====================================================================
 * 差距#24：资料内问答学习/复盘（轻量版，纯前端规则生成，零依赖）
 * ---------------------------------------------------------------------
 * 后端未暴露「按文档取 chunk 正文 / outline」的读接口（knowledge 仅
 * upload/list/query/bind/remove，且 query 无 AI key 时 503）。故本卡片：
 *  - 主题/思维导图节点由文档名按分隔符规则派生；
 *  - 测验卡为规则版（填空/问答），不调 AI，无 key 也可用；
 *  - 待后端补 GET /knowledge/:id（chunk 正文 + outline）后，可平滑升级
 *    为「原文关键句挖空 + 真实大纲层级」。
 * ===================================================================== */
interface FlashCard {
  q: string;
  a: string;
}

/** 从文档名派生主题方向（去扩展名后按常见分隔符切分） */
function deriveTopics(name: string): string[] {
  return name
    .replace(/\.(pdf|md|txt|markdown)$/i, '')
    .split(/[\/·•|—–\-_，,;；：:\s]+/)
    .map((s) => s.trim())
    .filter((t) => t && t.length >= 2)
    .slice(0, 8);
}

/** 规则生成 3-5 张复习卡（Q=问题/挖空，A=原文/答案） */
function buildFlashCards(docName: string, topics: string[]): FlashCard[] {
  const cards: FlashCard[] = [];
  cards.push({ q: `这份资料「${docName}」主要围绕哪些主题方向展开？`, a: topics.length > 0 ? topics.join('、') : docName });
  topics.slice(0, 3).forEach((t) => {
    cards.push({ q: `从资料名判断，它覆盖的核心主题之一是「____」`, a: t });
  });
  cards.push({
    q: `复盘：读完这份资料，你能用自己的话复述 ${topics[0] || '其核心内容'} 吗？`,
    a: '（请口头复述后对照资料原文检查要点是否遗漏）',
  });
  return cards.slice(0, 5);
}

/** 自绘 SVG 思维导图：根=文档名，子节点=派生主题；teal→cyan→sky 品牌色，节点可折叠 */
function MindMap({ root, leaves }: { root: string; leaves: string[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const H = Math.max(140, leaves.length * 38 + 70);
  const W = 720;
  const rootX = 90;
  const rootY = H / 2;
  const leafX = 470;
  const leafH = 26;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
      {/* 连线（贝塞尔 parent→child） */}
      {!collapsed &&
        leaves.map((_, i) => {
          const ly = 36 + i * 38 + leafH / 2;
          return (
            <path
              key={`e-${i}`}
              d={`M ${rootX + 110} ${rootY} C ${rootX + 220} ${rootY}, ${leafX - 60} ${ly}, ${leafX} ${ly}`}
              fill="none"
              stroke="var(--viz-series-6)"
              strokeWidth={1.4}
            />
          );
        })}
      {/* 根节点（点击折叠/展开子树） */}
      <g onClick={() => setCollapsed((v) => !v)} className="cursor-pointer">
        <rect x={rootX} y={rootY - 22} width={220} height={44} rx={10} fill="var(--brand-400)" />
        <text x={rootX + 110} y={rootY + 4} textAnchor="middle" fontSize={12} fill="#ffffff" fontWeight={600}>
          {root.length > 16 ? root.slice(0, 16) + '…' : root}
        </text>
        <text x={rootX + 110} y={rootY + 36} textAnchor="middle" fontSize={9} fill="var(--brand-600)">
          {collapsed ? '▸ 点击展开子树' : '▾ 点击折叠'}
        </text>
      </g>
      {/* 子节点（cyan→sky 交替） */}
      {!collapsed &&
        leaves.map((t, i) => {
          const ly = 36 + i * 38;
          const fill = i % 2 === 0 ? 'var(--viz-series-2)' : 'var(--sky-500)';
          return (
            <g key={`n-${i}`}>
              <rect x={leafX} y={ly} width={200} height={leafH} rx={8} fill={fill} />
              <text x={leafX + 100} y={ly + 17} textAnchor="middle" fontSize={11} fill="#ffffff">
                {t.length > 18 ? t.slice(0, 18) + '…' : t}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** 从真实 chunk 正文按句切分挖空（纯前端规则，无 AI 降级）：取 18-80 字的完整句子，挖掉中间一段 4-8 字 */
function buildCardsFromChunks(docName: string, detail: KnowledgeDocDetail): FlashCard[] | null {
  const sentences: string[] = [];
  for (const c of detail.chunks) {
    for (const s of c.content.split(/(?<=[。！？；!?;。.])|\n+/)) {
      const t = s.trim().replace(/^#+\s*/, '');
      if (t.length >= 18 && t.length <= 80) sentences.push(t);
    }
  }
  if (sentences.length === 0) return null;
  // 稳定取样：按句子哈希选前 3 个分散句子（避免每次渲染抖动）
  const picked = sentences
    .map((s, i) => ({ s, h: (i * 2654435761) % 997 }))
    .sort((a, b) => a.h - b.h)
    .slice(0, 3)
    .map((x) => x.s);
  const cards: FlashCard[] = picked.map((s) => {
    const start = Math.max(2, Math.floor(s.length * 0.25));
    const len = Math.min(8, Math.max(4, Math.floor(s.length / 4)));
    const ans = s.slice(start, start + len);
    const q = `${s.slice(0, start)}＿＿＿${s.slice(start + len)}`;
    return { q: `挖空填空：${q}`, a: ans };
  });
  cards.push({ q: `这份资料「${docName}」的核心脉络是什么？请口述后对照分块原文检查要点是否遗漏。`, a: '（答案为开放式：回看各节小标题与关键句，查漏补缺）' });
  return cards.slice(0, 5);
}

/** 思维导图叶子：优先 outline 真实标题；无则按 chunk 序号+开头派生；都没有则文档名规则 */
function buildLeaves(docName: string, detail: KnowledgeDocDetail | null): string[] {
  if (detail?.outline) {
    const heads = detail.outline.split('\n').map((s) => s.trim()).filter(Boolean);
    if (heads.length > 0) return heads.slice(0, 10);
  }
  if (detail && detail.chunks.length > 0) {
    return detail.chunks.slice(0, 8).map((c, i) => `第${i + 1}节 · ${c.content.replace(/\s+/g, ' ').slice(0, 14)}…`);
  }
  return deriveTopics(docName);
}

function StudyReviewCard({ docs }: { docs: KnowledgeDoc[] }) {
  const [docId, setDocId] = useState('');
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [detail, setDetail] = useState<KnowledgeDocDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const doc = docs.find((d) => d.id === docId) ?? null;

  // 选中文档后拉真实 chunk 正文 + outline（GET /knowledge/:id）；在事件处理器内取数（无 effect 同步 setState）
  const pickDoc = (id: string) => {
    setDocId(id);
    setRevealed({});
    setDetail(null);
    if (!id) {
      setLoadingDetail(false);
      return;
    }
    setLoadingDetail(true);
    api.knowledge
      .get(id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  };

  const topics = useMemo(() => (doc ? deriveTopics(doc.name) : []), [doc]);
  const cards = useMemo(() => {
    if (!doc) return [];
    if (detail && detail.chunks.length > 0) {
      const fromChunks = buildCardsFromChunks(doc.name, detail);
      if (fromChunks) return fromChunks;
    }
    return buildFlashCards(doc.name, topics);
  }, [doc, detail, topics]);
  const leaves = useMemo(() => (doc ? buildLeaves(doc.name, detail) : []), [doc, detail]);

  return (
    <Card className="p-4 sm:p-5 mb-4">
      <SectionTitle>
        <span className="flex items-center gap-2">
          <Brain size={16} className="text-teal-600" /> 学习复盘
        </span>
      </SectionTitle>
      <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
        选一份资料，前端规则生成复习卡 + 思维导图（资料内问答）。已接入分块取数：挖空来自原文句子，思维导图优先用真实章节标题；无 AI key 也可用。
      </div>
      <div className="max-w-md">
        <select
          value={docId}
          onChange={(e) => pickDoc(e.target.value)}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 outline-none focus:border-teal-500"
        >
          <option value="">选择一份资料…</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {loadingDetail && (
        <div className="mt-4">
          <Spinner label="读取分块正文…" />
        </div>
      )}

      {doc && !loadingDetail && cards.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">复习卡（点击翻面）{detail ? ' · 来自原文挖空' : ' · 文档名规则'}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {cards.map((c, i) => (
              <div
                key={i}
                onClick={() => setRevealed((m) => ({ ...m, [i]: !m[i] }))}
                className="cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-900/50 hover:border-teal-300 transition-colors"
              >
                <div className="text-[11px] text-teal-600 dark:text-teal-400 mb-1">{revealed[i] ? '答案' : '问题/填空'}</div>
                <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                  {revealed[i] ? c.a : c.q}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {doc && !loadingDetail && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">思维导图{detail?.outline ? ' · 真实章节标题' : detail ? ' · 按分块派生' : ''}</div>
          {leaves.length > 0 ? (
            <MindMap root={doc.name} leaves={leaves} />
          ) : (
            <div className="text-xs text-slate-400">文档名过于简短，暂无可拆分的主题节点</div>
          )}
        </div>
      )}
    </Card>
  );
}

export function KnowledgePage({ project }: { project: Project }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<KnowledgeQueryResult | null>(null);
  const [busy, setBusy] = useState('');
  /* 语义地图：展开时才拉数据（避免首屏多一次 embedding 全表扫描） */
  const [mapOpen, setMapOpen] = useState(false);
  const [error, setError] = useState('');
  const toast = useContext(ToastContext);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeDoc | null>(null);
  // 文献库↔知识库打通（#5）：项目内可选文献 + 正在展开绑定下拉的文档
  const [bindingDocId, setBindingDocId] = useState<string | null>(null);
  // 绑定下拉的标题搜索关键词（前端过滤 title/venue/年份）
  const [bindQuery, setBindQuery] = useState('');
  // RAG 引用可点（#17）：已展开原文的来源块（按 chunkId 记录）
  const [openChunks, setOpenChunks] = useState<Record<string, boolean>>({});
  // RAG 一键引用到论文：正在选择目标文档的来源块 + 项目文档列表 + 已引用标记
  const [citeSource, setCiteSource] = useState<KnowledgeSource | null>(null);
  const [citeDocs, setCiteDocs] = useState<Doc[]>([]);
  const [citing, setCiting] = useState(false);
  const [citedKeys, setCitedKeys] = useState<Record<string, boolean>>({});

  // 知识库文档列表 + 文献库（React Query）
  const qc = useQueryClient();
  const kbDocsQuery = useQuery({ queryKey: ['kb-docs', project.id], queryFn: () => api.knowledge.list(project.id) });
  const kbRefsQuery = useQuery({ queryKey: ['kb-refs', project.id], queryFn: () => api.references.list(project.id), retry: 0 });
  const mapQuery = useQuery({
    queryKey: ['kb-map', project.id],
    queryFn: () => api.knowledge.semanticMap(project.id),
    enabled: mapOpen,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const docs: KnowledgeDoc[] = useMemo(() => kbDocsQuery.data ?? [], [kbDocsQuery.data]);
  const refs: Reference[] = useMemo(() => kbRefsQuery.data ?? [], [kbRefsQuery.data]);
  const load = async () => {
    await qc.invalidateQueries({ queryKey: ['kb-docs', project.id] });
    await qc.invalidateQueries({ queryKey: ['kb-refs', project.id] });
  };

  /** 绑定/解除文献：referenceId 传 null 解除 */
  const bindRef = async (doc: KnowledgeDoc, referenceId: string | null) => {
    setError('');
    try {
      await api.knowledge.bind(doc.id, referenceId);
      toast('success', referenceId ? `已绑定「${refs.find((r) => r.id === referenceId)?.title || '文献'}」` : `已解除「${doc.name}」的文献绑定`);
      setBindingDocId(null);
      await load();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const toggleChunk = (key: string) => setOpenChunks((m) => ({ ...m, [key]: !m[key] }));

  /** RAG 一键引用：打开目标文档选择弹层（懒加载项目内论文草稿） */
  const openCite = async (s: KnowledgeSource) => {
    if (!s.referenceId) return; // 未绑定文献：按钮已禁用
    setCiteSource(s);
    try {
      setCiteDocs(await api.documents.list(project.id));
    } catch {
      setCiteDocs([]);
    }
  };

  /** 选定目标文档 → 幂等写入引用（references.addCitation 已去重） */
  const doCite = async (docId: string) => {
    if (!citeSource || !citeSource.referenceId) return;
    setCiting(true);
    try {
      await api.references.addCitation({
        documentId: docId,
        referenceId: citeSource.referenceId,
        location: 'rag:' + citeSource.docName,
        context: (citeSource.chunkText || '').slice(0, 200),
      });
      const key = citeSource.chunkId || citeSource.docName;
      setCitedKeys((m) => ({ ...m, [key]: true }));
      toast('success', `已引用「${citeSource.docName}」到论文`);
      setCiteSource(null);
    } catch (e: unknown) {
      setError(errMsg(e) || '引用失败');
    } finally {
      setCiting(false);
    }
  };


  // 绑定文献搜索：前端实时过滤 title / venue / 年份（数据已在 refs）
  const filteredRefs = useMemo(() => {
    const q = bindQuery.trim().toLowerCase();
    if (!q) return refs;
    return refs.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.venue || '').toLowerCase().includes(q) ||
        (r.year ? String(r.year).includes(q) : false),
    );
  }, [refs, bindQuery]);

  // 文档类型分布 Donut（pdf/markdown/text）
  const typeDist = useMemo(() => {
    const order: { key: string; label: string; color: string }[] = [
      { key: 'pdf', label: 'PDF', color: 'var(--rose-500)' },
      { key: 'markdown', label: 'Markdown', color: 'var(--sky-500)' },
      { key: 'text', label: '纯文本', color: 'var(--viz-series-6)' },
    ];
    const counts: Record<string, number> = { pdf: 0, markdown: 0, text: 0 };
    docs.forEach((d) => {
      if (d.type in counts) counts[d.type]++;
      else counts.text++;
    });
    return order.filter((o) => counts[o.key] > 0).map((o) => ({ label: o.label, value: counts[o.key], color: o.color }));
  }, [docs]);

  // 分块量 HBar（按 chunkCount 降序 Top 8）
  const chunkDist = useMemo(
    () =>
      [...docs]
        .sort((a, b) => b.chunkCount - a.chunkCount)
        .slice(0, 8)
        .map((d) => ({
          // 窄屏标签更短，避免左侧标签吃掉绘图区（390 实测长文件名会把柱子挤到只剩一小段）
          label: d.name.length > 16 ? d.name.slice(0, 16) + '…' : d.name,
          value: d.chunkCount,
          hint: d.name,
        })),
    [docs],
  );

  const uploadFile = async (file: File) => {
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const type = isPdf ? 'pdf' : file.name.toLowerCase().endsWith('.md') ? 'markdown' : 'text';
    setBusy(`upload:${file.name}`);
    setError('');
    try {
      const content = isPdf ? await fileToBase64(file) : await file.text();
      await api.knowledge.upload(project.id, file.name, type, content);
      toast('success', `「${file.name}」已入库`);
      await load();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy('query');
    setError('');
    try {
      setAnswer(await api.knowledge.query(project.id, q));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const remove = (doc: KnowledgeDoc) => {
    setDeleting(doc);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.knowledge.remove(deleting.id);
      setDeleting(null);
      setAnswer(null);
      load();
      toast('info', `「${deleting.name}」已删除`);
    } catch (e: unknown) {
      setError(errMsg(e));
      setDeleting(null);
    }
  };

  return (
    <div className="page-container">
      <ErrorBox message={error} />

      {/* 上传区 */}
      <Card className="p-4 sm:p-5 mb-4">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Upload size={16} className="text-teal-600" /> 上传研究资料
          </span>
        </SectionTitle>
        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            dragging ? 'border-teal-500 bg-teal-50/80 border-dashed' : 'border-slate-300 dark:border-slate-700 hover:border-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) uploadFile(file);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = '';
            }}
          />
          <FileText size={28} className="mx-auto text-slate-400 dark:text-slate-500 mb-2" />
          <div className="text-sm text-slate-600 dark:text-slate-300">点击选择或拖拽 PDF / TXT / Markdown 到此处</div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">支持 PDF 解析与自动分块（基于资料的可溯源问答）</div>
          {busy.startsWith('upload:') && (
            <div className="mt-2">
              <Spinner label={`解析 ${busy.slice(7)}…`} />
            </div>
          )}
        </div>

        {/* 语义地图（F-2.2）：默认折叠，展开时才拉数据（只读已有向量，不触发嵌入模型） */}
        {docs.length > 0 && (
          <div className="mt-4">
            <button
              className="w-full flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:border-teal-300 transition-colors"
              onClick={() => setMapOpen((v) => !v)}
              aria-expanded={mapOpen}
              aria-controls="semantic-map-panel"
            >
              <span className="flex items-center gap-1.5">
                <ScatterChart size={13} className="text-teal-600" aria-hidden="true" /> 语义地图（分块向量分布）
              </span>
              <span className="text-[11px] text-slate-400">{mapOpen ? '收起 ▾' : '展开 ▸'}</span>
            </button>
            {mapOpen && (
              <div id="semantic-map-panel" className="mt-2 rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                {mapQuery.isLoading ? (
                  <div className="text-xs text-slate-400 py-6 text-center">正在计算投影…</div>
                ) : mapQuery.isError ? (
                  <div className="text-xs text-rose-500 py-4">{errMsg(mapQuery.error)}</div>
                ) : (
                  <SemanticMap
                    points={mapQuery.data?.points ?? []}
                    total={mapQuery.data?.total ?? 0}
                    sampled={mapQuery.data?.sampled ?? false}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* 资料概览可视化 */}
        {docs.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">文档类型分布</div>
                <Donut segments={typeDist} size={84} thickness={11} centerValue={String(docs.length)} centerLabel="份资料" />
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">分块量 Top {chunkDist.length}</div>
                <HBar items={chunkDist} />
              </div>
            </div>
          </div>
        )}

        {/* 资料列表 */}
        <div className="mt-4">
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">知识库（{docs.length} 份资料）</div>
          {docs.length === 0 ? (
            <EmptyState illustration="knowledge" title="知识库还没有资料" hint="上传 PDF / Markdown / 文本后即可基于资料提问" />
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5">
                  <BookMarked size={15} className="text-teal-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 dark:text-slate-200 truncate">{d.name}</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      <Badge tone={d.type === 'pdf' ? 'red' : d.type === 'markdown' ? 'blue' : 'slate'}>{d.type}</Badge>
                      <span className="ml-2">{d.chunkCount} 个分块</span>
                    </div>
                    {/* 文献库↔知识库打通（#5）：绑定状态 + 绑定/解除 */}
                    {d.reference ? (
                      <div className="text-[11px] text-teal-600 dark:text-teal-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        <Link2 size={11} className="shrink-0" />
                        <span className="truncate">
                          对应文献：{d.reference.authors ? <span className="text-slate-500 dark:text-slate-400">{d.reference.authors} </span> : null}{d.reference.title}
                          {d.reference.year ? `（${d.reference.year}${d.reference.venue ? ` / ${d.reference.venue}` : ''}）` : d.reference.venue ? `（${d.reference.venue}）` : ''}
                        </span>
                        <button onClick={() => bindRef(d, null)} className="inline-flex items-center gap-0.5 text-slate-400 hover:text-rose-500 shrink-0" title="解除绑定">
                          <Unlink size={11} /> 解除
                        </button>
                      </div>
                    ) : bindingDocId === d.id ? (
                      <div className="mt-1.5 w-full max-w-md">
                        <Input
                          autoFocus
                          placeholder="搜索文献标题 / 期刊 / 年份…"
                          value={bindQuery}
                          onChange={(e) => setBindQuery(e.target.value)}
                          className="h-8 text-[12px]"
                        />
                        {refs.length > 0 ? (
                          filteredRefs.length > 0 ? (
                            <div className="mt-1.5 max-h-32 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                              {filteredRefs.map((r) => (
                                <button
                                  key={r.id}
                                  onClick={() => bindRef(d, r.id)}
                                  className="w-full text-left px-2.5 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                                >
                                  <div className="text-[12px] text-slate-700 dark:text-slate-200 truncate">{r.title}</div>
                                  {(r.year || r.venue) && (
                                    <div className="text-[11px] text-slate-400 truncate">
                                      {[r.venue, r.year].filter(Boolean).join(' · ')}
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">未找到文献？可先在文献调研页录入</div>
                          )
                        ) : (
                          <span className="mt-1.5 block text-[11px] text-slate-400 dark:text-slate-500">本项目暂无文献，请到「文献库」录入后再绑定</span>
                        )}
                        <button onClick={() => setBindingDocId(null)} className="mt-1 text-[11px] text-slate-400 hover:text-slate-600 shrink-0">
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setBindQuery('');
                          setBindingDocId(d.id);
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-teal-500 hover:underline"
                      >
                        <Link2 size={11} /> 绑定文献
                      </button>
                    )}
                  </div>
                  <button onClick={() => remove(d)} className="text-slate-400 dark:text-slate-500 hover:text-rose-500 shrink-0" title="删除">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 差距#24：学习复盘（复习卡 + 思维导图，纯前端规则生成） */}
      <StudyReviewCard docs={docs} />

      {/* RAG 问答 */}
      <Card className="p-4 sm:p-5">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <MessageSquare size={16} className="text-teal-600 dark:text-teal-300" /> 基于资料问答
          </span>
        </SectionTitle>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="例如：Transformer 的核心机制是什么？" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <Button onClick={ask} disabled={busy === 'query' || !question.trim()} className="shrink-0">
            {busy === 'query' ? <Loader2 size={15} className="animate-spin" /> : <MessageSquare size={15} />} 提问
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">答案严格来自你的资料（资料内问答），不依赖外部知识</div>

        {busy === 'query' && (
          <div className="mt-4">
            <Spinner label="检索资料并综合回答…" />
          </div>
        )}
        {answer && (
          <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-200">{answer.answer}</div>
            {answer.sources.length > 0 && (
              <div className="mt-3 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">回答依据来源（条越长匹配度越高，弱相关一眼可见）</div>
                <HBar
                  items={answer.sources.map((s) => ({
                    label: s.docName,
                    value: s.score,
                    sub: `匹配 ${s.score}%`,
                    hint: s.snippet,
                    color: s.score >= 70 ? undefined : s.score >= 40 ? 'var(--amber-500)' : 'var(--rose-500)',
                  }))}
                />
                <div className="mt-2 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                  {answer.sources.map((s, i) => {
                    const key = s.chunkId || `src-${i}`;
                    const open = !!openChunks[key];
                    const long = s.chunkText && s.chunkText.length > s.snippet.length;
                    const totalChunks = docs.find((d) => d.name === s.docName)?.chunkCount;
                    const chunkNo = typeof s.chunkSeq === 'number' ? s.chunkSeq + 1 : null;
                    return (
                      <div key={key} className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-600 dark:text-slate-300 font-medium">「{s.docName}」</span>
                          {chunkNo !== null && (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                              分块 {chunkNo}{totalChunks ? `/${totalChunks}` : ''}
                            </span>
                          )}
                          {long && (
                            <button
                              onClick={() => toggleChunk(key)}
                              className="inline-flex items-center gap-0.5 text-teal-500 hover:underline"
                            >
                              {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              {open ? '收起原文' : '展开原文'}
                            </button>
                          )}
                          {citedKeys[key] ? (
                            <span className="inline-flex items-center gap-0.5 text-teal-600 dark:text-teal-400"><Check size={11} />已引用</span>
                          ) : (
                            <button
                              onClick={() => openCite(s)}
                              disabled={!s.referenceId}
                              title={s.referenceId ? '把这段来源引用进你的论文草稿' : '先在上方资料列表把这份资料绑定到文献，再引用'}
                              className="inline-flex items-center gap-0.5 text-teal-500 hover:underline disabled:text-slate-300 dark:disabled:text-slate-600 disabled:no-underline disabled:cursor-not-allowed"
                            >
                              <Quote size={11} /> 引用到论文
                            </button>
                          )}
                        </div>
                        <div>
                          {s.snippet}
                          {!open && long ? '…' : ''}
                        </div>
                        {open && s.chunkText && (
                          <div className="mt-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                            <div className="flex items-center gap-2 border-l-[3px] border-l-teal-500 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                              <FileText size={12} className="text-teal-500 shrink-0" />
                              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                                来源：{s.docName} · 分块 {chunkNo ?? '?'}{totalChunks ? `/${totalChunks}` : ''}
                              </span>
                            </div>
                            {s.referenceTitle && (
                              <div className="px-2.5 pt-1.5 text-[11px] text-teal-600/90 dark:text-teal-400/90">📄 对应文献：{s.referenceAuthors ? <span className="text-slate-500 dark:text-slate-400">{s.referenceAuthors} </span> : null}{s.referenceTitle}{s.referenceYear ? ` (${s.referenceYear})` : ''}</div>
                            )}
                            <div className="px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                              {s.chunkText}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 删除资料确认弹窗 */}
      <ConfirmDialog
        open={!!deleting}
        title="删除资料"
        description={deleting ? `确定要删除「${deleting.name}」及其全部 ${deleting.chunkCount} 个内容分块吗？删除后无法恢复。` : undefined}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />

      {/* RAG 一键引用：选择目标论文草稿 */}
      <Modal open={!!citeSource} onClose={() => !citing && setCiteSource(null)} title="引用到论文">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          把来源「{citeSource?.docName}」引用进哪篇论文草稿？（已绑定文献：{citeSource?.referenceTitle || '—'}）
        </div>
        {citeDocs.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">本项目暂无论文草稿，请到「论文写作」新建一篇</div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {citeDocs.map((d) => (
              <button
                key={d.id}
                disabled={citing}
                onClick={() => doCite(d.id)}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 flex items-center gap-2"
              >
                <FileText size={13} className="text-teal-500 shrink-0" />
                <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{d.title}</span>
                {citing && <Loader2 size={13} className="animate-spin ml-auto" />}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
