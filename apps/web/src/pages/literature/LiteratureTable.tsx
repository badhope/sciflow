import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { ExtractionHeatmap } from './ExtractionHeatmap';
import { BookOpenCheck, FileDown, FlaskConical, Loader2, ShieldCheck, StickyNote, Trash2, Upload } from 'lucide-react';
import type { EvidenceResult, PaperComparisonResult, Project, Reference, ReferenceGraph, DeepDiveResult, GapResult, ExtractedPaper, ExtractionField, ExtractionTableResult, ScreeningItem } from '../../types';
import { Badge, Button, Card, CollapsibleCard, ConfirmDialog, Empty, ErrorBox, Input, Spinner, Textarea, jsonText, errMsg } from '../../components/ui';
import { ChartEmpty, Donut, HBar } from '../../components/charts';
import { ToastContext } from '../../App';
import { api } from '../../api/client';
import { Tool } from './LiteratureTools';

type ScreenStatus = 'pending' | 'included' | 'excluded' | 'uncertain';
export const SCREEN_META: Record<ScreenStatus, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' }> = {
  pending: { label: '待筛', tone: 'slate' },
  included: { label: '纳入', tone: 'green' },
  excluded: { label: '排除', tone: 'red' },
  uncertain: { label: '不确定', tone: 'amber' },
};

export const READING_TONE: Record<string, 'slate' | 'amber' | 'green' | 'blue'> = {
  unread: 'slate',
  reading: 'amber',
  read: 'green',
  cited: 'blue',
};

const READING_LABEL: Record<string, string> = {
  unread: '未读',
  reading: '在读',
  read: '已读',
  cited: '已引',
};
const READING_ORDER = ['unread', 'reading', 'read', 'cited'] as const;

export interface LiteratureTableProps {
  project: Project;
  refs: Reference[];
  setRefs: (updater: (prev: Reference[]) => Reference[]) => void;
  hits: Reference[];
  setHits: (r: Reference[]) => void;
  searching: boolean;
  setSearching: (v: boolean) => void;
  query: string;
  setQuery: (v: string) => void;
  imported: Set<string>;
  setImported: (updater: (prev: Set<string>) => Set<string>) => void;
  selectedRefs: Set<string>;
  setSelectedRefs: (updater: (prev: Set<string>) => Set<string>) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  // screening
  screenItems: ScreeningItem[];
  setScreenItems: (items: ScreeningItem[]) => void;
  // extraction
  extFields: ExtractionField[];
  setExtFields: (f: ExtractionField[]) => void;
  extTable: ExtractionTableResult | null;
  setExtTable: (t: ExtractionTableResult | null) => void;
  showExtraction: boolean;
  setShowExtraction: (v: boolean) => void;
  // bibtex
  showImport: boolean;
  setShowImport: (v: boolean) => void;
  bibText: string;
  setBibText: (v: string) => void;
  importing: boolean;
  setImporting: (v: boolean) => void;
  // add form
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  // busy / error
  busy: string;
  setBusy: (v: string) => void;
  error: string;
  setError: (v: string) => void;
  // tools callbacks
  setSummary: (v: string) => void;
  setExtracted: (v: ExtractedPaper[]) => void;
  setEvidence: (v: EvidenceResult | null) => void;
  question: string;
  setQuestion: (v: string) => void;
  setDeepDive: (v: DeepDiveResult | null) => void;
  deepDiveRef: string;
  setDeepDiveRef: (v: string) => void;
  setGapResult: (v: GapResult | null) => void;
  gapTopic: string;
  setGapTopic: (v: string) => void;
  setComparison: (v: PaperComparisonResult | null) => void;
  setGraph: (v: ReferenceGraph | null) => void;
  setGraphLoading: (v: boolean) => void;
  // sub-tool busy flags
  summary: string;
  extracted: ExtractedPaper[];
  evidence: EvidenceResult | null;
  deepDive: DeepDiveResult | null;
  gapResult: GapResult | null;
  comparison: PaperComparisonResult | null;
  graph: ReferenceGraph | null;
  graphLoading: boolean;
}

const authors = (a: string) => jsonText<string[]>(a, []).join(', ') || '佚名';

export function LiteratureTable(props: LiteratureTableProps) {
  const {
    project, refs, setRefs,
    hits, setHits, searching, setSearching, query, setQuery,
    imported, setImported,
    selectedRefs, setSelectedRefs,
    tool: _tool, setTool,
    screenItems, setScreenItems,
    extFields, setExtFields, extTable, setExtTable,
    showExtraction, setShowExtraction,
    showImport, setShowImport, bibText, setBibText, importing, setImporting,
    showAdd, setShowAdd,
    busy: _busy, setBusy: _setBusy, error: _error, setError,
    setSummary: _setSummary, setExtracted: _setExtracted, setEvidence: _setEvidence, question: _question, setQuestion: _setQuestion,
    setDeepDive, deepDiveRef: _deepDiveRef, setDeepDiveRef,
    setGapResult: _setGapResult, gapTopic: _gapTopic, setGapTopic: _setGapTopic,
    setComparison: _setComparison, setGraph, setGraphLoading: _setGraphLoading,
  } = props;

  const toast = useContext(ToastContext);

  // 手动添加表单
  const [addTitle, setAddTitle] = useState('');
  const [addAuthors, setAddAuthors] = useState('');
  const [addYear, setAddYear] = useState('');
  const [addVenue, setAddVenue] = useState('');
  const [addDoi, setAddDoi] = useState('');
  const [addAbstract, setAddAbstract] = useState('');
  const [adding, setAdding] = useState(false);

  // BibTeX
  const onPickBibFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setBibText(String(reader.result || ''));
    reader.readAsText(f);
  };

  const doImportBibtex = async () => {
    if (!bibText.trim()) {
      setError('请粘贴或选择 BibTeX 文件');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const res = await api.references.importBibtex(project.id, bibText);
      toast('success', `导入完成：新增 ${res.imported} 条，跳过重复 ${res.skipped} 条`);
      setBibText('');
      setShowImport(false);
      const importedRefs = await api.references.list(project.id);
      setRefs(() => importedRefs);
      setGraph(null); // 下次进入网络 Tab 时重新聚合
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setImporting(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const results = await api.references.search(query.trim(), 8, project.id);
      setHits(results);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setSearching(false);
    }
  };

  const addManual = async () => {
    if (!addTitle.trim()) {
      setError('文献标题必填');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const r = await api.references.create(project.id, {
        title: addTitle.trim(),
        authors: addAuthors.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        year: addYear ? Number(addYear) : undefined,
        venue: addVenue.trim(),
        doi: addDoi.trim(),
        abstract: addAbstract.trim(),
      });
      toast('success', '文献已加入文献库');
      setRefs((s: Reference[]) => (s.some((x) => x.id === r.id) ? s : [r, ...s]));
      setAddTitle(''); setAddAuthors(''); setAddYear(''); setAddVenue(''); setAddDoi(''); setAddAbstract('');
      setShowAdd(false);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setAdding(false);
    }
  };

  const importOne = async (hit: Reference) => {
    try {
      const r = await api.references.create(project.id, hit);
      toast('success', '文献已加入文献库');
      setRefs((s: Reference[]) => (s.some((x) => x.id === r.id) ? s : [r, ...s]));
      setImported((s) => new Set(s).add(r.title));
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const importAll = async () => {
    const pending = hits.filter((h) => !imported.has(h.title));
    if (pending.length === 0) return;
    try {
      const created = await api.references.importMany(project.id, pending);
      setRefs((s: Reference[]) => [...created.filter((r) => !s.some((x) => x.id === r.id)), ...s]);
      setImported((s) => new Set([...s, ...pending.map((p) => p.title)]));
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const [deletingRef, setDeletingRef] = useState<{ id: string; title: string } | null>(null);
  const confirmRemoveRef = async () => {
    if (!deletingRef) return;
    try {
      await api.references.remove(deletingRef.id);
      setRefs((s: Reference[]) => s.filter((r) => r.id !== deletingRef.id));
      toast('info', `已移除文献「${deletingRef.title}」`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setDeletingRef(null);
    }
  };

  // BibTeX/RIS export
  const doExport = async (format: 'bibtex' | 'ris') => {
    try {
      const { downloadText } = await import('../../components/ui');
      const text = await api.references.exportReferences(project.id, format);
      downloadText(
        `${project.name || 'references'}.${format === 'bibtex' ? 'bib' : 'ris'}`,
        text,
        format === 'bibtex' ? 'application/x-bibtex;charset=utf-8' : 'application/x-research-info-systems;charset=utf-8',
      );
      toast('success', format === 'bibtex' ? '已导出 BibTeX' : '已导出 RIS');
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  // 差距#1/#11/#20
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const setReadingStatus = async (ref: Reference, status: string) => {
    try {
      const updated = await api.references.update(ref.id, { readingStatus: status });
      setRefs((s: Reference[]) => s.map((r) => (r.id === ref.id ? { ...r, readingStatus: updated.readingStatus } : r)));
      toast('success', `已标记为「${READING_LABEL[status] || status}」`);
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const openNoteEditor = (ref: Reference) => {
    if (noteEditId === ref.id) {
      setNoteEditId(null);
      setNoteDraft('');
      return;
    }
    setNoteEditId(ref.id);
    setNoteDraft(ref.notes || '');
  };

  const saveNote = async (ref: Reference) => {
    try {
      const updated = await api.references.update(ref.id, { notes: noteDraft.trim() });
      setRefs((s: Reference[]) => s.map((r) => (r.id === ref.id ? { ...r, notes: updated.notes } : r)));
      setNoteEditId(null);
      setNoteDraft('');
      toast('success', '阅读笔记已保存');
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const verifyDois = async () => {
    const withDoi = refs.filter((r) => r.doi && r.doi.trim());
    if (withDoi.length === 0) {
      setError('当前文献库没有带 DOI 的文献，无法核验');
      return;
    }
    setVerifyBusy(true);
    setError('');
    try {
      const res = await api.references.verifyDois(withDoi.map((r) => r.id));
      const verifiedRefs = await api.references.list(project.id);
      setRefs(() => verifiedRefs);
      toast(
        'success',
        `DOI 核验完成：格式合法 ${res.valid.length} 篇（已标「已引」），不合法 ${res.invalid.length} 篇`,
      );
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setVerifyBusy(false);
    }
  };

  // screening
  const screenMap = useMemo(() => new Map(screenItems.map((s) => [s.referenceId, s])), [screenItems]);
  const refreshScreen = async () => {
    try {
      setScreenItems(await api.references.screenList(project.id));
    } catch { /* 静默降级 */ }
  };
  const doScreen = async (refId: string, status: ScreenStatus, reason = '') => {
    try {
      await api.references.screen(project.id, refId, status, reason);
      refreshScreen();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  // extraction
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState('');
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldKind, setNewFieldKind] = useState<'text' | 'select'>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  const loadExtraction = async () => {
    setExtLoading(true);
    setExtError('');
    try {
      const [fields, table] = await Promise.all([
        api.references.extractionFields(project.id),
        api.references.extractionTable(project.id),
      ]);
      setExtFields(fields);
      setExtTable(table);
    } catch (e: unknown) {
      setExtError(errMsg(e));
      setExtFields([]);
      setExtTable(null);
    } finally {
      setExtLoading(false);
    }
  };

  // 抽取表开启时加载（事件驱动：onToggle 里触发，不再用 effect）
  const toggleExtraction = () => {
    const next = !showExtraction;
    setShowExtraction(next);
    if (next) void loadExtraction();
  };

  const addField = async () => {
    if (!newFieldKey.trim() || !newFieldLabel.trim()) {
      setExtError('字段 key 与显示名必填');
      return;
    }
    try {
      const opts = newFieldKind === 'select' ? newFieldOptions.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
      await api.references.addExtractionField(project.id, newFieldKey.trim(), newFieldLabel.trim(), newFieldKind, opts);
      setNewFieldKey(''); setNewFieldLabel(''); setNewFieldOptions('');
      loadExtraction();
      toast('success', '抽取字段已添加');
    } catch (e: unknown) {
      setExtError(errMsg(e));
    }
  };

  const removeField = async (id: string) => {
    try {
      await api.references.removeExtractionField(id);
      loadExtraction();
      toast('info', '字段已删除');
    } catch (e: unknown) {
      setExtError(errMsg(e));
    }
  };

  const saveExtValue = useCallback(async (fieldId: string, referenceId: string, value: string) => {
    try {
      await api.references.setExtractionValue(fieldId, referenceId, value);
    } catch (e: unknown) {
      setExtError(errMsg(e));
    }
  }, []);

  // visualization aggregation
  const yearDist = useMemo(() => {
    const m = new Map<string, number>();
    refs.forEach((r) => {
      const y = r.year ? String(r.year) : '未知';
      m.set(y, (m.get(y) || 0) + 1);
    });
    // 按年份升序展示（趋势可读）；「未知」固定排最后，避免占据首位误导
    return [...m.entries()]
      .map(([label, value]) => ({ name: label, value, hint: `${label} 年：${value} 篇` }))
      .sort((a, b) => (a.name === '未知' ? 1 : b.name === '未知' ? -1 : Number(a.name) - Number(b.name)))
      .slice(0, 12);
  }, [refs]);

  const topCited = useMemo(() => {
    return [...refs]
      .filter((r) => r.citationCount > 0)
      .sort((a, b) => b.citationCount - a.citationCount)
      .slice(0, 8)
      .map((r) => ({
        name: r.title.length > 36 ? r.title.slice(0, 36) + '…' : r.title,
        value: r.citationCount,
        sub: `${r.year || 'n.d.'}·${(r.venue || '').slice(0, 14)}`,
        hint: r.title,
      }));
  }, [refs]);

  const venueDist = useMemo(() => {
    const m = new Map<string, number>();
    refs.forEach((r) => {
      const v = r.venue?.trim() || '未标注';
      m.set(v, (m.get(v) || 0) + 1);
    });
    const entries = [...m.entries()].map(([label, value]) => ({ name: label, value })).sort((a, b) => b.value - a.value);
    const top = entries.slice(0, 5);
    const rest = entries.slice(5);
    if (rest.length) top.push({ name: '其他', value: rest.reduce((s, x) => s + x.value, 0) });
    return top;
  }, [refs]);

  // 系统综述：筛选队列
  // 大列表分批渲染：文献上千条时一次性挂载全部卡片会明显卡顿（每张卡含 4 个按钮 + 2 个输入）。
  // 分批追加而不是虚拟滚动——卡片高度随「筛选理由/阅读状态」动态变化，固定行高会裁内容。
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // 切换项目或文献集合变化时回到第一批（否则新项目会沿用上个项目的展开量）
  useEffect(() => setVisibleCount(PAGE_SIZE), [project.id, refs.length]);
  const [showScreen, setShowScreen] = useState(false);
  const [screenFilter, setScreenFilter] = useState<'all' | ScreenStatus>('all');
  const [screenSelected, setScreenSelected] = useState<Set<string>>(new Set());
  const [screenBusy, setScreenBusy] = useState(false);

  const doScreenBulk = async (status: ScreenStatus) => {
    if (screenSelected.size === 0) return;
    setScreenBusy(true);
    try {
      await api.references.screenBulk(project.id, [...screenSelected], status);
      refreshScreen();
      toast('success', `已批量${SCREEN_META[status].label} ${screenSelected.size} 篇`);
      setScreenSelected(new Set());
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setScreenBusy(false);
    }
  };

  const filteredScreenItems = useMemo(
    () => (screenFilter === 'all' ? screenItems : screenItems.filter((s) => s.status === screenFilter)),
    [screenItems, screenFilter],
  );
  const allFilteredSelected = filteredScreenItems.length > 0 && filteredScreenItems.every((s) => screenSelected.has(s.referenceId));

  // included refs for screening output
  const includedRefs = useMemo(
    () => screenItems.filter((s) => s.status === 'included').sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
    [screenItems],
  );
  const csvEscape = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const extCellValue = (f: ExtractionField, raw: string) => {
    const v = (raw ?? '').trim();
    if (!v) return '';
    if (f.kind === 'select') return v.split(/[;；\n]/).map((s) => s.trim()).filter(Boolean).join('; ');
    return v;
  };

  // TanStack Table：抽取矩阵（动态列 = 文献信息 + 各抽取字段；表头点击排序）
  const [extSorting, setExtSorting] = useState<SortingState>([{ id: 'year', desc: false }]);
  const extColumns = useMemo<ColumnDef<ExtractionTableResult['rows'][number]>[]>(() => {
    const info: ColumnDef<ExtractionTableResult['rows'][number]>[] = [
      {
        id: 'title',
        header: '文献',
        accessorFn: (r) => r.title,
        cell: (ctx) => {
          const row = ctx.row.original;
          return (
            <div className="text-left">
              <div className="font-medium text-slate-700 dark:text-slate-200 leading-snug max-w-[200px] truncate" title={row.title}>{row.title}</div>
              <div className="text-slate-400 dark:text-slate-500 mt-0.5">{row.year || 'n.d.'} · {row.venue || '未标注'}</div>
            </div>
          );
        },
      },
      { id: 'year', header: '年份', accessorFn: (r) => r.year ?? 0, cell: () => null, enableSorting: true },
    ];
    const fieldCols: ColumnDef<ExtractionTableResult['rows'][number]>[] = extFields.map((f) => ({
      id: `f_${f.id}`,
      header: f.label,
      accessorFn: (r) => String(r.values[f.key] ?? r.values[f.id] ?? ''),
      cell: (ctx) => {
        const row = ctx.row.original;
        const val = String(row.values[f.key] ?? row.values[f.id] ?? '');
        return f.kind === 'select' ? (
          <select
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 text-xs outline-none focus:border-teal-500"
            value={val}
            onChange={(e) => saveExtValue(f.id, row.referenceId, e.target.value)}
          >
            <option value="">—</option>
            {f.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ) : (
          <Input className="text-xs h-7" placeholder="…" defaultValue={val} onBlur={(e) => saveExtValue(f.id, row.referenceId, e.target.value)} />
        );
      },
    }));
    // 年份列仅用于排序、不占视觉列：把它并入 title 列之后但隐藏渲染
    return [...info.filter((c) => c.id !== 'year'), ...fieldCols];
  }, [extFields, saveExtValue]);
  const extRows = extTable?.rows ?? [];
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table 的 getXxxRowModel 返回不可记忆化函数；本调用无 memo 需求，跳过 Compiler 记忆化是预期行为
  const extTableInstance = useReactTable({
    data: extRows,
    columns: extColumns,
    state: { sorting: extSorting },
    onSortingChange: setExtSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const exportExtractionCsv = async () => {
    if (!extTable || extTable.rows.length === 0 || extFields.length === 0) {
      setExtError('暂无编码数据可导出：请先定义字段并完成至少一篇文献的编码');
      return;
    }
    const header = ['文献标题', '年份', '期刊', ...extFields.map((f) => f.label)];
    const lines = [header.map(csvEscape).join(',')];
    extTable.rows.forEach((row) => {
      const base = [row.title, row.year ?? '', row.venue ?? ''].map((x) => String(x ?? ''));
      const cells = extFields.map((f) => extCellValue(f, row.values[f.key] ?? row.values[f.id] ?? ''));
      lines.push([...base, ...cells].map(csvEscape).join(','));
    });
    const { downloadText } = await import('../../components/ui');
    downloadText(`编码抽取表_${project.name || 'references'}.csv`, '' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast('success', '已导出编码表 CSV');
  };

  const authorShort = (s: ScreeningItem) => {
    let names: string[] = [];
    try {
      names = jsonText<string[]>(s.authors, []);
    } catch { names = []; }
    if (!Array.isArray(names) || names.length === 0) {
      names = String(s.authors || '').split(/[,;；]/).map((x) => x.trim()).filter(Boolean);
    }
    return names[0] || '佚名';
  };

  const buildCompareMd = () => {
    const lines = ['# 纳入文献对比表（PRISMA）', '', `> 共 ${includedRefs.length} 篇纳入文献`, '', '| 标题 | 年份 | 期刊 | 结论/备注 |', '| --- | --- | --- | --- |'];
    includedRefs.forEach((s) => {
      const pipe = (v: string) => String(v ?? '').replace(/\|/g, '\\|');
      lines.push(`| ${pipe(s.title)} | ${s.year || 'n.d.'} | ${pipe(s.venue || '未标注')} | ${pipe(s.reason || '')} |`);
    });
    return lines.join('\n');
  };

  const buildReviewDraft = () => {
    const parts = includedRefs.map(
      (s) => `${authorShort(s)}等（${s.year || 'n.d.'}）在《${s.venue || '相关期刊'}》发表的「${s.title}」[${authorShort(s)} ${s.year || 'n.d.'}]，为该方向提供了实证与理论依据。`,
    );
    return [
      '## 文献综述草稿（自动生成，待润色）',
      '',
      `围绕本研究主题，共纳入 ${includedRefs.length} 篇代表性文献。${parts.join('')}`,
      '',
      '综上，现有研究已积累一定基础，但仍存在可进一步深化之处（请结合各文献真实结论与分歧点手动润色）。',
    ].join('\n');
  };

  const copyToClipboard = async (text: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', okMsg);
    } catch {
      setError('复制失败：浏览器未授权剪贴板，请改用下载');
    }
  };

  return (
    <>
      {/* 检索区 */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-1.5 mb-2.5 text-slate-700 dark:text-slate-200 font-semibold">
          <FlaskConical size={15} className="text-teal-600 dark:text-teal-300" /> 文献调研
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input
            className="flex-1 min-w-52"
            placeholder="在我的文献库中检索标题 / 作者 / 摘要，如：图神经网络"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <Button onClick={search} disabled={searching || !query.trim()}>
            {searching ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />} 检索
          </Button>
          <Button variant="outline" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? <Trash2 size={15} /> : <FlaskConical size={15} />} {showAdd ? '收起添加' : '手动添加文献'}
          </Button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-2">这里检索的是你已录入的本地文献库（离线可用，不联网）。还没有文献？试试：粘贴 DOI、导入 BibTeX、或手动录入</div>

        {/* 手动添加表单 */}
        {showAdd && (
          <div className="mt-3 p-3 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/10 space-y-2">
            <div className="grid md:grid-cols-2 gap-2">
              <Input placeholder="标题 *" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
              <Input placeholder="作者（逗号分隔）" value={addAuthors} onChange={(e) => setAddAuthors(e.target.value)} />
              <Input placeholder="年份（可选）" value={addYear} onChange={(e) => setAddYear(e.target.value)} />
              <Input placeholder="期刊 / 会议（可选）" value={addVenue} onChange={(e) => setAddVenue(e.target.value)} />
              <Input placeholder="DOI（可选）" value={addDoi} onChange={(e) => setAddDoi(e.target.value)} />
            </div>
            <Textarea rows={2} placeholder="摘要（可选）" value={addAbstract} onChange={(e) => setAddAbstract(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={addManual} disabled={adding || !addTitle.trim()}>
                {adding ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />} 保存到文献库
              </Button>
              <Button variant="ghost" onClick={() => setShowAdd(false)}>取消</Button>
            </div>
          </div>
        )}
      </Card>

      {/* 检索结果 */}
      {hits.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">检索结果（{hits.length} 篇）</span>
            <Button variant="success" className="text-xs" onClick={importAll}>
              <FlaskConical size={14} /> 全部导入文献库
            </Button>
          </div>
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {hits.map((h, i) => (
              <div key={i} className="flex items-start gap-3 border border-slate-100 dark:border-slate-800 rounded-lg p-3 hover:border-teal-300 hover:shadow-[0_2px_10px_-4px_rgba(13,148,136,0.18)] transition-all duration-150">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{h.title}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {authors(h.authors)} · {h.year || 'n.d.'} · {h.venue}
                    {h.doi && <span className="text-emerald-600"> · DOI:{h.doi}</span>}
                    {h.citationCount ? ` · 被引 ${h.citationCount}` : ''}
                  </div>
                  {h.abstract && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{h.abstract}</div>}
                  <div className="mt-1.5">
                    <Badge tone="blue">{h.source}</Badge>
                  </div>
                </div>
                <Button variant={imported.has(h.title) ? 'ghost' : 'outline'} className="text-xs shrink-0" disabled={imported.has(h.title)} onClick={() => importOne(h)}>
                  {imported.has(h.title) ? '已导入' : '导入'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 左列：文献库 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <FlaskConical size={14} /> 文献库（{refs.length} 条）
          </span>
          {selectedRefs.size > 0 && (
            <Badge tone="teal">已选 {selectedRefs.size} 篇（可用于对比）</Badge>
          )}
        </div>
        {/* 文献交换工具区 */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Button variant="outline" className="text-xs h-7 px-2" disabled={refs.length === 0} onClick={() => doExport('bibtex')}>
            <FileDown size={12} /> 导出 BibTeX
          </Button>
          <Button variant="outline" className="text-xs h-7 px-2" disabled={refs.length === 0} onClick={() => doExport('ris')}>
            <FileDown size={12} /> 导出 RIS
          </Button>
          <Button variant="outline" className="text-xs h-7 px-2" onClick={() => setShowImport(!showImport)}>
            <Upload size={12} /> 导入 BibTeX
          </Button>
          <Button
            variant="outline"
            className="text-xs h-7 px-2"
            disabled={verifyBusy || refs.length === 0}
            onClick={verifyDois}
            title="本地批量核验带 DOI 文献：格式合法者自动标记为「已引」，不联网"
          >
            {verifyBusy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} 核验 DOI
          </Button>
        </div>
        {showImport && (
          <div className="mb-3 p-3 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 space-y-2">
            <Textarea
              rows={5}
              placeholder={'粘贴 BibTeX 内容，例如：\n@article{key,\n  title = {Attention Is All You Need},\n  author = {Vaswani, A.},\n  year = {2017}\n}'}
              value={bibText}
              onChange={(e) => setBibText(e.target.value)}
            />
            <input type="file" accept=".bib,.txt,text/plain" onChange={onPickBibFile} className="text-xs text-slate-500 dark:text-slate-400" />
            <div className="flex gap-2">
              <Button onClick={doImportBibtex} disabled={importing || !bibText.trim()}>
                {importing ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} 导入到文献库
              </Button>
              <Button variant="ghost" onClick={() => setShowImport(false)}>取消</Button>
            </div>
          </div>
        )}
        {refs.length === 0 ? (
          <Empty text="文献库为空。三步获得第一批文献：① 粘贴 DOI（自动识别去重）② 导入 BibTeX（文件/粘贴）③ 手动添加文献或上传全文到知识库" />
        ) : (
          <>
            {/* 文献库统计概览 */}
            <div className="mb-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">年份分布</div>
                  <HBar data={yearDist} />
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">来源 / venue 分布</div>
                  <Donut data={venueDist} size={80} thickness={11} centerValue={String(refs.length)} centerLabel="篇总量" />
                </div>
              </div>
              {topCited.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-800">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">高被引 Top {topCited.length}</div>
                  <HBar data={topCited} />
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
              {refs.slice(0, visibleCount).map((r) => {
                const sc = screenMap.get(r.id);
                const scStatus: ScreenStatus = sc?.status ?? 'pending';
                return (
                  <div key={r.id} className="border border-slate-100 dark:border-slate-800 rounded-lg p-2.5 flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1.5 accent-teal-600"
                      checked={selectedRefs.has(r.id)}
                      onChange={() => setSelectedRefs((s0) => { const n = new Set(s0); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                      title="勾选后可用于文献对比"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-1.5">
                        <div className="text-sm text-slate-800 dark:text-slate-100">{r.title}</div>
                        {scStatus !== 'pending' && <Badge tone={SCREEN_META[scStatus].tone}>{SCREEN_META[scStatus].label}</Badge>}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {authors(r.authors)} · {r.year || 'n.d.'} · {r.venue}
                        {r.doi && <span className="text-emerald-600"> · DOI:{r.doi}</span>}
                      </div>
                      {/* 筛选状态按钮组 */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(['included', 'excluded', 'uncertain'] as const).map((st) => {
                          const active = scStatus === st;
                          const toneCls =
                            st === 'included'
                              ? active
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-emerald-300'
                              : st === 'excluded'
                              ? active
                                ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-rose-300'
                              : active
                              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-amber-300';
                          return (
                            <button
                              key={st}
                              onClick={() => doScreen(r.id, st)}
                              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${toneCls}`}
                              title={`标记为${SCREEN_META[st].label}（系统综述筛选）`}
                            >
                              {SCREEN_META[st].label}
                            </button>
                          );
                        })}
                      </div>
                      {scStatus !== 'pending' && (
                        <Input
                          className="mt-1.5 text-xs h-7"
                          placeholder="筛选理由（可选，失焦保存）"
                          defaultValue={sc?.reason ?? ''}
                          onBlur={(e) => doScreen(r.id, scStatus, e.target.value.trim())}
                        />
                      )}
                      {/* 阅读状态机（差距#1）：未读/在读/已读/已引 */}
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        <span className="text-[11px] text-slate-400 mr-0.5">阅读</span>
                        {READING_ORDER.map((st) => {
                          const active = (r.readingStatus || 'unread') === st;
                          return (
                            <button
                              key={st}
                              onClick={() => setReadingStatus(r, st)}
                              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                                active
                                  ? 'bubble-user border-transparent'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-teal-300 hover:text-teal-600'
                              }`}
                              title={`标记为${READING_LABEL[st]}`}
                            >
                              {READING_LABEL[st]}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => openNoteEditor(r)}
                          className={`ml-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                            noteEditId === r.id || r.notes
                              ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-amber-300'
                          }`}
                          title="阅读笔记（读后想法，本地保存）"
                        >
                          <StickyNote size={11} /> {r.notes ? '笔记' : '记笔记'}
                        </button>
                      </div>
                      {noteEditId === r.id && (
                        <div className="mt-1.5 space-y-1.5">
                          <Textarea
                            rows={2}
                            className="text-xs"
                            placeholder="记录这篇文献的方法、结论、可用之处……"
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                          />
                          <div className="flex gap-1.5">
                            <Button className="text-xs h-7 px-2" onClick={() => saveNote(r)}>保存笔记</Button>
                            <Button variant="ghost" className="text-xs h-7 px-2" onClick={() => openNoteEditor(r)}>取消</Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      className="text-slate-400 hover:text-teal-600 shrink-0 mt-0.5"
                      title="AI 深度精读这篇文献"
                      onClick={() => {
                        setTool('deepdive');
                        setDeepDiveRef(r.id);
                        setDeepDive(null);
                      }}
                    >
                      <BookOpenCheck size={14} />
                    </button>
                    <button className="p-1 text-slate-400 hover:text-rose-500" aria-label={`删除文献 ${r.title}`} onClick={() => setDeletingRef({ id: r.id, title: r.title })}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
              {/* 分批加载：还有未渲染条目时给出明确入口（不做无限自动追加，避免长列表持续重排） */}
              {refs.length > visibleCount && (
                <button
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs text-slate-500 dark:text-slate-400 hover:border-teal-300 hover:text-teal-600 transition-colors"
                  onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                >
                  还有 {refs.length - visibleCount} 条，加载更多
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ================= 系统综述：筛选队列 ================= */}
      <CollapsibleCard
        icon={<FlaskConical size={16} className="text-teal-600" />}
        title="筛选队列（系统综述 PRISMA 筛选）"
        summary={`共 ${screenItems.length} 条 · 纳入 ${screenItems.filter((s) => s.status === 'included').length} / 排除 ${screenItems.filter((s) => s.status === 'excluded').length}`}
        open={showScreen}
        onToggle={() => setShowScreen((v) => !v)}
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 outline-none"
            value={screenFilter}
            onChange={(e) => setScreenFilter(e.target.value as 'all' | ScreenStatus)}
          >
            <option value="all">全部（{screenItems.length}）</option>
            <option value="pending">待筛（{screenItems.filter((s) => s.status === 'pending').length}）</option>
            <option value="included">纳入（{screenItems.filter((s) => s.status === 'included').length}）</option>
            <option value="excluded">排除（{screenItems.filter((s) => s.status === 'excluded').length}）</option>
            <option value="uncertain">不确定（{screenItems.filter((s) => s.status === 'uncertain').length}）</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              className="accent-teal-600"
              checked={allFilteredSelected}
              onChange={() => {
                setScreenSelected((prev) => {
                  const next = new Set(prev);
                  if (allFilteredSelected) filteredScreenItems.forEach((s) => next.delete(s.referenceId));
                  else filteredScreenItems.forEach((s) => next.add(s.referenceId));
                  return next;
                });
              }}
            />
            全选当前（已选 {screenSelected.size}）
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="text-xs"
              disabled={includedRefs.length === 0}
              title="把「纳入」状态文献渲染为 Markdown 对比表并下载"
              onClick={async () => {
                const { downloadText } = await import('../../components/ui');
                downloadText('compare_' + (project.name || 'references') + '.md', buildCompareMd(), 'text/markdown;charset=utf-8');
              }}
            >
              <FlaskConical size={13} /> 对比表 MD
            </Button>
            <Button
              variant="outline"
              className="text-xs"
              disabled={includedRefs.length === 0}
              title="复制对比表到剪贴板"
              onClick={() => copyToClipboard(buildCompareMd(), '对比表 Markdown 已复制')}
            >
              复制对比表
            </Button>
            <Button
              variant="outline"
              className="text-xs"
              disabled={includedRefs.length === 0}
              title="把纳入文献按年份拼成带 [作者 年份] 引用的综述草稿"
              onClick={async () => {
                const { downloadText } = await import('../../components/ui');
                downloadText('review_draft_' + (project.name || 'references') + '.md', buildReviewDraft(), 'text/markdown;charset=utf-8');
              }}
            >
              <FileDown size={13} /> 综述草稿
            </Button>
            <Button
              variant="outline"
              className="text-xs"
              disabled={includedRefs.length === 0}
              title="复制综述草稿到剪贴板"
              onClick={() => copyToClipboard(buildReviewDraft(), '综述草稿已复制')}
            >
              复制草稿
            </Button>
            <Button variant="success" className="text-xs" disabled={screenSelected.size === 0 || screenBusy} onClick={() => doScreenBulk('included')}>
              {screenBusy ? <Loader2 size={13} className="animate-spin" /> : null} 一键纳入
            </Button>
            <Button variant="danger" className="text-xs" disabled={screenSelected.size === 0 || screenBusy} onClick={() => doScreenBulk('excluded')}>
              {screenBusy ? <Loader2 size={13} className="animate-spin" /> : null} 一键排除
            </Button>
          </div>
        </div>

        {filteredScreenItems.length === 0 ? (
          <ChartEmpty message="暂无筛选记录。在左侧文献库点击「纳入/排除/不确定」按钮，即可把文献加入筛选队列" />
        ) : (
          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {filteredScreenItems.map((s) => (
              <div key={s.id} className="flex items-start gap-2.5 border border-slate-100 dark:border-slate-800 rounded-lg p-2.5">
                <input
                  type="checkbox"
                  className="mt-1 accent-teal-600"
                  checked={screenSelected.has(s.referenceId)}
                  onChange={() =>
                    setScreenSelected((prev) => {
                      const n = new Set(prev);
                      if (n.has(s.referenceId)) n.delete(s.referenceId); else n.add(s.referenceId);
                      return n;
                    })
                  }
                  title="勾选后可批量操作"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800 dark:text-slate-100 leading-snug">{s.title}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {s.year || 'n.d.'} · {s.venue || '未标注'}
                  </div>
                  {s.reason && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">理由：{s.reason}</div>}
                </div>
                <Badge tone={SCREEN_META[s.status].tone}>{SCREEN_META[s.status].label}</Badge>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* ================= 系统综述：编码抽取表 ================= */}
      <CollapsibleCard
        icon={<FlaskConical size={16} className="text-teal-600" />}
        title="编码抽取表（跨文献数据矩阵）"
        summary={extTable ? `${extFields.length} 字段 · ${extTable.rows.length} 篇` : '定义抽取字段并逐篇编码'}
        open={showExtraction}
        onToggle={toggleExtraction}
      >
        <ErrorBox message={extError} />
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">行=文献，列=字段；select 多选值以「; 」连接，UTF-8 BOM 可直接用 Excel 打开</span>
          <Button variant="outline" className="text-xs shrink-0" disabled={!extTable || extTable.rows.length === 0} onClick={exportExtractionCsv}>
            <FlaskConical size={13} /> 导出编码表 CSV
          </Button>
        </div>

        {extFields.length > 0 && extTable && extTable.rows.length > 0 && (
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3 mb-3">
            <ExtractionHeatmap
              fields={extFields.map((f) => ({ id: f.id, label: f.label }))}
              rows={extTable.rows}
            />
          </div>
        )}

        <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3 mb-3">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">抽取字段管理</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {extFields.length === 0 ? (
              <span className="text-[11px] text-slate-400 dark:text-slate-500">尚未定义字段，下方添加第一个编码字段</span>
            ) : (
              extFields.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 text-[11px]">
                  {f.label}
                  <span className="text-slate-400">({f.kind})</span>
                  <button className="text-slate-400 hover:text-rose-500" title="删除字段" onClick={() => removeField(f.id)}>
                    <span className="text-xs">×</span>
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="grid md:grid-cols-4 gap-2">
            <Input placeholder="字段 key（英文标识，如 sampleSize）" value={newFieldKey} onChange={(e) => setNewFieldKey(e.target.value)} className="text-xs" />
            <Input placeholder="显示名（如 样本量）" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} className="text-xs" />
            <select
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 outline-none"
              value={newFieldKind}
              onChange={(e) => setNewFieldKind(e.target.value as 'text' | 'select')}
            >
              <option value="text">文本输入</option>
              <option value="select">下拉选择</option>
            </select>
            {newFieldKind === 'select' && (
              <Input placeholder="选项（逗号分隔，如  RCT,队列,综述）" value={newFieldOptions} onChange={(e) => setNewFieldOptions(e.target.value)} className="text-xs" />
            )}
            <Button variant="outline" className="text-xs" onClick={addField} disabled={!newFieldKey.trim() || !newFieldLabel.trim()}>
              <FlaskConical size={13} /> 添加字段
            </Button>
          </div>
        </div>

        {extLoading ? (
          <Spinner label="加载抽取矩阵…" />
        ) : !extTable || extTable.rows.length === 0 || extFields.length === 0 ? (
          <ChartEmpty message="暂无编码数据：先在上方添加抽取字段，系统将以文献为行、字段为列生成可编辑矩阵" />
        ) : (
          <div className="overflow-auto rounded-lg border border-slate-100 dark:border-slate-800 max-h-[420px]">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 sticky top-0">
                {extTableInstance.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className={`px-2 py-2 text-left ${h.column.id === 'title' ? 'min-w-[200px]' : 'min-w-[120px]'}`}
                        onClick={h.column.id === 'title' ? undefined : h.column.getToggleSortingHandler()}
                        title={h.column.id === 'title' ? undefined : '点击排序'}
                      >
                        <span className={h.column.id === 'title' ? '' : 'cursor-pointer select-none'}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getIsSorted() === 'asc' ? ' ↑' : h.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                        </span>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {extTableInstance.getRowModel().rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                    {r.getVisibleCells().map((c) => (
                      <td key={c.id} className={c.column.id === 'title' ? 'px-2 py-2' : 'px-2 py-1.5'}>
                        {flexRender(c.column.columnDef.cell ?? ((ctx: { getValue: () => unknown }) => String(ctx.getValue() ?? '')), c.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>
      <ConfirmDialog
        open={!!deletingRef}
        title="移除文献"
        description={`确定从文献库移除「${deletingRef?.title ?? ''}」？该文献的引用与编码数据会一并删除，无法恢复。`}
        confirmText="移除"
        danger
        onConfirm={confirmRemoveRef}
        onClose={() => setDeletingRef(null)}
      />
    </>
  );
}
