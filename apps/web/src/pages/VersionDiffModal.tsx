import { useEffect, useMemo, useState } from 'react';
import { diffLines as diffLibLines } from 'diff';
import { api } from '../api/client';
import { Button, Modal, Select, errMsg } from '../components/ui';

/** 版本快照（doc.versions 为 {version,content,updatedAt,name?}[] JSON 字符串；current 为当前编辑态） */
export type VersionSnapshot = { version: number; content: string; updatedAt: number; current?: boolean; name?: string };

/* =====================================================================
 * 行级 diff：基于 `diff` 库（成熟 LCS 实现，支持行/字/字符级别对比）
 * 独立 chunk，仅打开对比时加载。
 * ===================================================================== */

type DiffRow = { kind: 'same' | 'del' | 'add'; left: string | null; right: string | null };
type DiffResult = { rows: DiffRow[]; truncated: boolean };

/** 行数兜底：超过此行数才截断（极端场景） */
const MAX_DIFF_LINES = 2000;

function diffLines(oldText: string, newText: string): DiffResult {
  let oldLines = oldText.split('\n');
  let newLines = newText.split('\n');
  let truncated = false;

  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    truncated = true;
    oldLines = oldLines.slice(0, MAX_DIFF_LINES);
    newLines = newLines.slice(0, MAX_DIFF_LINES);
  }

  const changes = diffLibLines(oldLines.join('\n'), newLines.join('\n'));
  const rows: DiffRow[] = [];

  for (const change of changes) {
    const lines = change.value.split('\n');
    // diff 库会在末尾多一个空行（当文本以换行结尾）
    const effective = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    for (const line of effective) {
      if (change.added) {
        rows.push({ kind: 'add', left: null, right: line });
      } else if (change.removed) {
        rows.push({ kind: 'del', left: line, right: null });
      } else {
        rows.push({ kind: 'same', left: line, right: line });
      }
    }
  }
  return { rows, truncated };
}

/* =====================================================================
 * 版本命名（缺口#2 前端半）：读写全走后端 PATCH /api/documents/:id/version-name
 * （client 方法 documents.setVersionName，返回更新后的 versions 数组）。
 * 一次性迁移浏览器 localStorage 旧命名到后端，成功后删 key，失败保留待重试。
 * ===================================================================== */
/** 旧版 localStorage key 前缀：sciflow:vname:<docId>:v<N> */
const vNamePrefix = (docId: string) => `sciflow:vname:${docId}:v`;

type SectionEntry = { title: string; level: number; status: 'unchanged' | 'changed' | 'added' | 'removed'; changed: boolean };

/**
 * 段落级恢复面板：列出所选历史版本与当前正文逐节差异，支持只回滚某一节。
 * 后端 POST /documents/:id/sections/restore 会先自动快照全文，避免误操作不可退。
 */
function SectionRestorePanel({ docId, snapshots, baseVersion }: { docId: string; snapshots: VersionSnapshot[]; baseVersion: string }) {
  const [sections, setSections] = useState<SectionEntry[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const versionNum = useMemo(
    () => (baseVersion === 'current' ? null : Number(baseVersion.replace('v', ''))),
    [baseVersion],
  );

  useEffect(() => {
    let cancelled = false;
    if (!docId || versionNum === null || !Number.isFinite(versionNum)) return;
    (async () => {
      try {
        const res = await api.documents.sectionDiff(docId, versionNum);
        if (!cancelled) setSections((res.sections || []) as SectionEntry[]);
      } catch (e: unknown) {
        if (!cancelled) setNote(`读取章节差异失败：${errMsg(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [docId, versionNum, snapshots]);

  const changedCount = sections.filter((s) => s.changed).length;

  /** 按意见修改：把本节在 diff 中识别出的差异描述作为评审要点交给模型定向重写 */
  const revise = async (title: string) => {
    const v = Number(baseVersion.replace('v', ''));
    const hit = sections.find((s) => s.title === title);
    if (!hit) return;
    const points = `与 v${v} 相比，本节存在「${hit.status}」差异；请按最新评审要求补全内容、消除该差异，并保持引用标记不变。`;
    setBusy(`revise:${title}`);
    setNote('');
    try {
      const res = await api.documents.reviseSection(docId, title, points);
      setNote(res.changed ? `已按意见重写「${title}」（修改前已自动快照）` : `「${title}」未产生变化`);
    } catch (e: unknown) {
      setNote(`修改失败：${errMsg(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (title: string) => {
    const v = Number(baseVersion.replace('v', ''));
    setBusy(title);
    setNote('');
    try {
      const res = await api.documents.restoreSection(docId, v, title);
      setNote(res.changed ? `已恢复「${title}」到 v${v}，其余章节未改动（恢复前已自动快照）` : `「${title}」与 v${v} 内容一致，无需恢复`);
    } catch (e: unknown) {
      setNote(`恢复失败：${errMsg(e)}`);
    } finally {
      setBusy(null);
    }
  };

  if (!docId || baseVersion === 'current' || sections.length === 0) {
    return note ? <div className="mt-2 text-[11px] text-amber-500">{note}</div> : null;
  }

  return (
    <div className="mt-3 border-t border-dashed border-slate-200 dark:border-slate-700 pt-2">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
        按章节恢复（{baseVersion}）：{changedCount} 节有差异，可只回滚某一节
      </div>
      <div className="space-y-1 max-h-40 overflow-auto">
        {sections.filter((s) => s.changed).map((s) => (
          <div key={`${s.title}-${s.status}`} className="flex items-center gap-2 text-[11px] rounded border border-slate-200 dark:border-slate-700 px-2 py-1">
            <span className={`rounded px-1.5 py-0.5 shrink-0 ${s.status === 'added' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : s.status === 'removed' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>{s.status}</span>
            <span className="truncate flex-1 text-slate-700 dark:text-slate-200">{s.title || '（无标题前言）'}</span>
            {s.status !== 'added' && (
              <>
                <Button variant="outline" className="text-[11px] px-1.5 py-0.5 shrink-0" disabled={busy !== null} onClick={() => restore(s.title)}>
                  {busy === s.title ? '恢复中…' : '恢复此节'}
                </Button>
                <Button variant="outline" className="text-[11px] px-1.5 py-0.5 shrink-0" disabled={busy !== null} onClick={() => revise(s.title)}>
                  {busy === `revise:${s.title}` ? '修改中…' : '按意见修改'}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      {note && <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{note}</div>}
    </div>
  );
}

export function VersionDiffModal({
  open,
  onClose,
  docId,
  snapshots,
  diffA,
  diffB,
  onSelectA,
  onSelectB,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  docId: string;
  snapshots: VersionSnapshot[];
  diffA: string;
  diffB: string;
  onSelectA: (v: string) => void;
  onSelectB: (v: string) => void;
  onRestore: (s: VersionSnapshot) => void;
}) {
  // 版本命名：优先后端 versions[].name，本地态兜底会话内即时刷新。
  // 后端 name 以「派生合并」接入（无 effect 播种）：本地已有值优先，其余来自快照。
  const [localNames, setLocalNames] = useState<Record<number, string>>({});
  const [migNote, setMigNote] = useState('');
  const names = useMemo(() => {
    const next: Record<number, string> = {};
    for (const s of snapshots) if (s.name) next[s.version] = s.name;
    return { ...next, ...localNames };
  }, [snapshots, localNames]);

  /** 一次性迁移：挂载/打开时把 localStorage 旧命名逐条写后端，成功后删 key；失败保留待重试 */
  useEffect(() => {
    if (!open || !docId) return;
    const prefix = vNamePrefix(docId);
    let cancelled = false;
    (async () => {
      let keys: string[] = [];
      try {
        keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      } catch {
        return;
      }
      if (keys.length === 0) return;
      let failed = 0;
      for (const k of keys) {
        const v = Number(k.slice(prefix.length));
        const name = (() => { try { return localStorage.getItem(k) || ''; } catch { return ''; } })();
        if (!Number.isFinite(v)) continue;
        if (!name) {
          try { localStorage.removeItem(k); } catch { /* ignore */ }
          continue;
        }
        try {
          await api.documents.setVersionName(docId, v, name);
          if (cancelled) return;
          setLocalNames((p) => ({ ...p, [v]: name }));
          try { localStorage.removeItem(k); } catch { /* ignore */ }
        } catch {
          failed++; // 保留原 key 供下次重试
        }
      }
      if (!cancelled && failed > 0) {
        setMigNote(`${failed} 个旧版本命名迁移到后端失败，已保留在浏览器本地，下次打开自动重试`);
      }
    })();
    return () => { cancelled = true; };
  }, [open, docId]);

  const getVName = (v: number) => names[v] || '';

  const renameVersion = async (v: number, name: string) => {
    const trimmed = name.trim();
    setLocalNames((p) => ({ ...p, [v]: trimmed })); // 乐观更新，会话内即时生效
    try {
      await api.documents.setVersionName(docId, v, trimmed);
    } catch (e: unknown) {
      setMigNote(`版本命名保存到后端失败：${errMsg(e)}（已保留本地显示，稍后重试）`);
    }
  };

  const snapOptions = snapshots.map((s) => ({
    value: s.current ? 'current' : `v${s.version}`,
    label: s.current
      ? `当前内容 (v${snapshots[snapshots.length - 1]?.version ?? '?'})`
      : `v${s.version} · ${new Date(s.updatedAt).toLocaleString()}${getVName(s.version) ? ` · ${getVName(s.version)}` : ''}`,
  }));
  const findSnap = (key: string): VersionSnapshot | null => {
    if (key === 'current') return snapshots[snapshots.length - 1] || null;
    const v = Number(key.replace('v', ''));
    return snapshots.find((s) => !s.current && s.version === v) || null;
  };
  const diffResult = useMemo(() => {
    const a = findSnap(diffA);
    const b = findSnap(diffB);
    if (!a || !b) return { rows: [] as DiffRow[], truncated: false };
    return diffLines(a.content, b.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffA, diffB, snapshots]);
  const diffRows = diffResult.rows;

  return (
    <Modal open={open} title="版本对比（左右栏 Diff）" onClose={onClose} width="max-w-5xl">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select options={snapOptions} value={diffA} onChange={onSelectA} className="text-xs flex-1" />
        <span className="text-slate-400 shrink-0">→</span>
        <Select options={snapOptions} value={diffB} onChange={onSelectB} className="text-xs flex-1" />
      </div>
      <div className="flex gap-2 mb-3 text-[11px] flex-wrap">
        {(['左', '右'] as const).map((side, idx) => {
          const key = idx === 0 ? diffA : diffB;
          const s = findSnap(key);
          if (!s) return null;
          return (
            <div key={side} className="flex-1 min-w-[180px] flex items-center gap-1.5">
              <span className="text-slate-400 shrink-0">{side} · v{s.version}</span>
              {s.current ? (
                <span className="text-[11px] text-slate-300 dark:text-slate-600 shrink-0">（当前内容，不可命名）</span>
              ) : (
                <input
                  key={`${s.version}-${getVName(s.version)}`}
                  className="flex-1 min-w-0 rounded border border-slate-200 dark:border-slate-700 bg-transparent px-1.5 py-0.5 text-xs"
                  placeholder="命名此版本…"
                  defaultValue={getVName(s.version)}
                  onBlur={(e) => renameVersion(s.version, e.target.value)}
                />
              )}
              {!s.current && (
                <Button variant="outline" className="text-[11px] px-1.5 py-0.5 shrink-0" onClick={() => onRestore(s)}>
                  恢复此版
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-0 font-mono text-[11px] leading-relaxed max-h-[58vh] overflow-auto border border-slate-100 dark:border-slate-800 rounded">
        {(['left', 'right'] as const).map((side) => (
          <div key={side} className={`min-w-0 ${side === 'left' ? 'border-r border-slate-100 dark:border-slate-800' : ''}`}>
            {diffRows.map((r, i) => {
              const txt = side === 'left' ? r.left : r.right;
              const hot = side === 'left' ? r.kind === 'del' : r.kind === 'add';
              return txt != null ? (
                <div key={i} className={`px-2 whitespace-pre-wrap break-words ${hot ? (side === 'left' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-300') : 'text-slate-600 dark:text-slate-300'}`}>{txt || ' '}</div>
              ) : (
                <div key={i} className="px-2 text-transparent"> </div>
              );
            })}
          </div>
        ))}
      </div>
      <SectionRestorePanel docId={docId} snapshots={snapshots} baseVersion={diffB} />
      <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
        红 = 左栏独有（相对删除） · 绿 = 右栏独有（新增） · 按行 LCS 对比（≤{MAX_DIFF_LINES} 行完整对比）。
        版本名保存在后端；浏览器本地旧命名已自动迁移。
        {diffResult.truncated && (
          <span className="text-amber-500 dark:text-amber-400"> · ⚠ 文本过长，已截取前 {MAX_DIFF_LINES} 行做对比（极端降级）</span>
        )}
        {migNote && <span className="text-amber-500 dark:text-amber-400 block mt-0.5"> · {migNote}</span>}
      </div>
    </Modal>
  );
}
