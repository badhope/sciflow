import { Suspense, lazy, useState } from 'react';
import { BookOpen, Crosshair, Loader2, Plus } from 'lucide-react';
import type { CitationRow, Reference } from '../../types';
import { Badge, Button, Modal, Select } from '../../components/ui';
import { Donut } from '../../components/charts';
import { CITE_STYLES } from './citeStyles';

const CiteReorderButton = lazy(() => import('../CiteReorderButton').then((m) => ({ default: m.CiteReorderButton })));

const SEC = 'text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5';

/**
 * WritingCitations — 引用管理子面板。
 *  - 引用核验率 Donut 图
 *  - 文献库选择器（直接在正文光标处插入 [n] 锚点）
 *  - 已引用列表（可补锚点 / 核验 badge）
 *  - 样式选择 + 渲染 + 导出 + 著者-年重排
 *  - 从文献库添加引用弹层（citePickerOpen）
 */
export function WritingCitations({
  refs,
  citations,
  exportFormat,
  exported,
  citePickerOpen,
  addingCiteId,
  history,
  onOpenPicker,
  onClosePicker,
  onInsertAnchor,
  onChangeFormat,
  onExport,
  docId,
  onApplyReorder,
  aiBusy: _aiBusy,
  renderDocExporter,
}: {
  refs: Reference[];
  citations: CitationRow[];
  exportFormat: string;
  exported: string[];
  citePickerOpen: boolean;
  addingCiteId: string | null;
  history: { type: string; original: string; polished: string; reason: string }[];
  onOpenPicker: () => void;
  onClosePicker: () => void;
  onInsertAnchor: (referenceId: string) => void;
  onChangeFormat: (format: string) => void;
  onExport: (format: string) => void;
  docId: string | null;
  onApplyReorder: (newContent: string) => void;
  aiBusy: boolean;
  /** DocExporter 插槽（lazy chunk） */
  renderDocExporter: React.ReactNode;
}) {
  return (
    <>
      {/*
        导出区放在面板最前：底部 Tab 面板高度约 40vh，若把导出放到引用列表之后，
        按钮会落在可视区之外（实测 1440×950 下按钮 top=959，用户必须滚动才能看到）。
        导出是高频操作，优先露出。
      */}
      <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className={SEC}>导出全文</div>
        {renderDocExporter}
      </div>

      {/* 引用管理 */}
      <div className="mb-4">
        <div className={`${SEC} flex items-center gap-1`}>
          <BookOpen size={12} /> 引用管理（文献库 {refs.length} 条）
        </div>
        {/* 引用核验率 Donut：citations 中 verified=1 占比 */}
        {citations.length > 0 && (() => {
          const verified = citations.filter((c) => c.verified === 1).length;
          const pct = Math.round((verified / citations.length) * 100);
          return (
            <div className="mb-2 rounded-lg border border-slate-100 dark:border-slate-800 p-2">
              <Donut
                size={64}
                thickness={9}
                centerValue={`${pct}%`}
                centerLabel="核验率"
                segments={[
                  { label: `已核验 ${verified}`, value: verified, color: 'var(--emerald-500)' },
                  { label: `未核验 ${citations.length - verified}`, value: citations.length - verified, color: 'var(--viz-series-6)' },
                ]}
              />
            </div>
          );
        })()}
        {refs.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">文献库为空，请先到「文献调研」检索导入</div>
        ) : (
          <select
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-xs bg-white dark:bg-slate-900"
            onChange={(e) => {
              if (e.target.value) onInsertAnchor(e.target.value);
              e.target.value = '';
            }}
            value=""
          >
            <option value="">先在正文点光标，再选文献插入 [n]…</option>
            {refs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title.slice(0, 40)}
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" className="text-xs w-full mt-1.5" onClick={onOpenPicker} disabled={refs.length === 0}>
          <Plus size={12} /> 从文献库添加引用
        </Button>
        {citations.length > 0 && (
          <div className="mt-2">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">已引用 {citations.length} 条（序号即正文 [n]）</div>
            <div className="max-h-28 overflow-y-auto space-y-1">
              {citations.map((c, i) => (
                <div key={c.id} className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded px-2 py-1">
                  <span className="shrink-0 font-mono text-teal-600 dark:text-teal-400">[{i + 1}]</span>
                  <span className="truncate flex-1">{c.reference.title}</span>
                  <button
                    title="在正文光标处再插一个锚点"
                    className="shrink-0 text-slate-400 hover:text-teal-600"
                    onClick={() => onInsertAnchor(c.referenceId)}
                  >
                    <Crosshair size={12} />
                  </button>
                  {c.verified ? <Badge tone="green">DOI✓</Badge> : <Badge>未核验</Badge>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-1.5 mt-2">
          <Select
            className="flex-1 text-xs"
            options={[...CITE_STYLES.map((s) => ({ value: s.value, label: s.label })), { value: 'bibtex', label: 'BibTeX (.bib)' }]}
            value={exportFormat}
            onChange={(v) => {
              onChangeFormat(v);
              onExport(v);
            }}
          />
          <Button variant="outline" className="text-xs" onClick={() => onExport(exportFormat)} disabled={citations.length === 0}>
            渲染列表
          </Button>
        </div>
        {/* 著者-年重排入口（独立 lazy chunk）：确认后 setContent→自动保存链 */}
        <Suspense fallback={null}>
          <CiteReorderButton docId={docId} style={exportFormat} citationsCount={citations.length} onApply={onApplyReorder} />
        </Suspense>
        {(() => {
          const meta = CITE_STYLES.find((s) => s.value === exportFormat);
          if (!meta) return null;
          return (
            <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              文中引用：<span className="font-mono text-slate-500 dark:text-slate-400">{meta.inText}</span>
              {!meta.numbered && '（锚点仍为 [n]，列表按引用序渲染）'}
            </div>
          );
        })()}
        {exported.length > 0 && (
          <div className="mt-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded p-2 text-xs text-slate-600 dark:text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
            {exported.map((e, i) => (
              <div key={i} className="mb-1">
                {e}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 历史记录 */}
      {history.length > 0 && (
        <div className="mb-4">
          <div className={SEC}>润色 / 翻译历史（可追溯）</div>
          <div className="space-y-1.5">
            {history.slice(0, 6).map((h, i) => (
              <details key={i} className="bg-slate-50 dark:bg-slate-900/50 rounded p-2 text-xs">
                <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
                  {h.type === 'polish' ? '润色' : h.type === 'reduce' ? '降重' : '翻译'} · {new Date().toLocaleTimeString()}
                </summary>
                <div className="mt-1 text-slate-400 dark:text-slate-500 max-h-20 overflow-y-auto">{h.reason}</div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* 引用添加弹层 */}
      <CitationPickerModal
        open={citePickerOpen}
        refs={refs}
        citations={citations}
        addingCiteId={addingCiteId}
        onClose={onClosePicker}
        onInsertAnchor={onInsertAnchor}
      />
    </>
  );
}

/** 文献库弹层：点选后幂等写入，成功后刷新引用列表 */
function CitationPickerModal({
  open,
  refs,
  citations,
  addingCiteId,
  onClose,
  onInsertAnchor,
}: {
  open: boolean;
  refs: Reference[];
  citations: CitationRow[];
  addingCiteId: string | null;
  onClose: () => void;
  onInsertAnchor: (referenceId: string) => void;
}) {
  /**
   * 文献库可能有上百条（本项目实测 85 条，其中相当一部分是与当前主题无关的历史文献）。
   * 原实现直接把 refs 原序铺满，用户要插一条引用得在列表里翻半天。
   * 这里：搜索框 + 「已引用 / 未引用」分组 + 已引用优先，最常用操作一眼可达。
   */
  const [q, setQ] = useState('');
  const kw = q.trim().toLowerCase();
  const filtered = kw
    ? refs.filter((r) => `${r.title} ${r.authors || ''} ${r.venue || ''} ${r.year || ''}`.toLowerCase().includes(kw))
    : refs;
  const sorted = [...filtered].sort((a, b) => {
    const ca = citations.some((c) => c.referenceId === a.id) ? 0 : 1;
    const cb = citations.some((c) => c.referenceId === b.id) ? 0 : 1;
    return ca - cb || (b.year || 0) - (a.year || 0);
  });
  return (
    <Modal open={open} title="从文献库添加引用" onClose={onClose} width="max-w-lg">
      {refs.length === 0 ? (
        <div className="text-xs text-slate-400 dark:text-slate-500">文献库为空，请先到「文献调研」检索导入。</div>
      ) : (
        <>
          <input
            className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-900"
            placeholder={`搜索文献（共 ${refs.length} 条，可按标题/作者/期刊/年份）`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜索文献"
          />
          {sorted.length === 0 && <div className="py-4 text-center text-xs text-slate-400">没有匹配「{q}」的文献</div>}
        <div className="max-h-80 overflow-y-auto space-y-1.5 pr-0.5">
          {sorted.map((r) => {
            const citedIdx = citations.findIndex((c) => c.referenceId === r.id);
            const cited = citedIdx >= 0;
            return (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 p-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-700 dark:text-slate-200 truncate">
                    {cited && <span className="font-mono text-teal-600 dark:text-teal-400 mr-1">[{citedIdx + 1}]</span>}
                    {r.title}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">{[r.year, r.venue].filter(Boolean).join(' · ')}</div>
                </div>
                <Button
                  variant="outline"
                  className="text-xs px-2 py-1 shrink-0"
                  title={cited ? '在正文光标处再插一个 [n] 锚点' : '加入引用并在正文光标处插入锚点'}
                  disabled={addingCiteId === r.id}
                  onClick={() => onInsertAnchor(r.id)}
                >
                  {addingCiteId === r.id ? <Loader2 size={11} className="animate-spin" /> : cited ? <Crosshair size={11} /> : <Plus size={11} />}
                  {cited ? '锚点' : ''}
                </Button>
              </div>
            );
          })}
        </div>
        </>
      )}
    </Modal>
  );
}
