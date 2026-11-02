import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, History, Lightbulb, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { MemoryItem, Project } from '../types';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Input, Spinner, Textarea, errMsg } from '../components/ui';
import { ChartEmpty, Donut, LineChart, MetricCard } from '../components/charts';

/** 记忆中心（Phase 2：Agentic Memory）
 * - 情景记忆 episodic：流水线完成时自动沉淀（主题/结构/评分），供后续任务参考
 * - 程序记忆 procedural：写作风格指令，起草时自动注入（可自行维护）
 */
export function MemoryPage({ project }: { project: Project }) {
  const [type, setType] = useState<'episodic' | 'procedural' | ''>('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MemoryItem | null>(null);

  // 记忆列表 + 概览（React Query；筛选变化即换 queryKey）
  const qc = useQueryClient();
  const itemsQuery = useQuery({ queryKey: ['memory', project.id, type, q], queryFn: () => api.memory.list(type, q, project.id) });
  const overviewQuery = useQuery({ queryKey: ['memory-all', project.id], queryFn: () => api.memory.list('', '', project.id), retry: 0 });
  const items: MemoryItem[] = itemsQuery.data ?? [];
  const allItems: MemoryItem[] = useMemo(() => overviewQuery.data ?? [], [overviewQuery.data]);
  const loading = itemsQuery.isLoading;
  const listError = itemsQuery.error ? errMsg(itemsQuery.error) : '';
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['memory'] });
    void qc.invalidateQueries({ queryKey: ['memory-all'] });
  };

  const addMemory = async () => {
    if (!newContent.trim()) return;
    setSaving(true);
    try {
      await api.memory.add(
        'procedural',
        newContent.trim(),
        project.id,
        newKeywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean),
      );
      setNewContent('');
      setNewKeywords('');
      setShowAdd(false);
      refresh();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = (item: MemoryItem) => {
    setDeleting(item);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.memory.remove(deleting.id);
      setDeleting(null);
      refresh();
    } catch (e: unknown) {
      setError(errMsg(e));
      setDeleting(null);
    }
  };

  const typeTone = (t: string) => (t === 'procedural' ? 'teal' : 'blue') as 'teal' | 'blue';

  /**
   * 近 7 天新增（KPI 卡用）。
   * 时间基准取「最新一条记忆的 createdAt」而不是 Date.now()：渲染期调用 Date.now()
   * 属于不纯调用（react-hooks/purity 已拦），且以数据最新时间为基准在快照/回放场景更稳定。
   */
  const weekNew = useMemo(() => {
    if (!allItems.length) return 0;
    const newest = Math.max(...allItems.map((m) => m.createdAt));
    const since = newest - 7 * 24 * 3600 * 1000;
    return allItems.filter((m) => m.createdAt >= since).length;
  }, [allItems]);

  /* ---- 概览派生（基于全量 allItems，不随筛选变化） ---- */
  const epiCount = allItems.filter((m) => m.type === 'episodic').length;
  const procCount = allItems.length - epiCount;

  // 按天聚合计数 → 记忆增长趋势
  const dayMap = new Map<string, number>();
  for (const m of allItems) {
    const d = new Date(m.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    dayMap.set(key, (dayMap.get(key) || 0) + 1);
  }
  const growth = [...dayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => {
      const [, mo, da] = key.split('-');
      return { label: `${Number(mo)}/${Number(da)}`, value: v };
    });

  // 关键词频次 Top 12
  const kwMap = new Map<string, number>();
  for (const m of allItems) for (const k of m.keywords || []) kwMap.set(k, (kwMap.get(k) || 0) + 1);
  const topKws = [...kwMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const maxKw = topKws.length ? topKws[0][1] : 1;

  return (
    <div className="page-container">
      <ErrorBox message={error || listError} />

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-semibold">
          <Brain size={16} className="text-teal-600 dark:text-teal-300" /> 记忆中心
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 mb-3">
          情景记忆自动沉淀每次完成的研究任务；程序记忆保存写作风格指令，起草时自动注入
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            {(['', 'episodic', 'procedural'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  type === t ? 'bg-white dark:bg-slate-900 shadow text-teal-700 font-medium' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {t === '' ? '全部' : t === 'episodic' ? '情景记忆' : '程序记忆'}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-40 flex items-center gap-1">
            <Search size={14} className="text-slate-400 dark:text-slate-500" />
            <Input placeholder="按关键词搜索（如：图神经、综述）" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={15} /> 新增写作指令
          </Button>
        </div>
      </Card>

      {/* KPI 卡：四个一眼可读的量化指标（此前这些数字只能从图表里读） */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricCard label="记忆总量" value={String(allItems.length)} hint="当前项目累计沉淀" accent="brand" />
        <MetricCard label="情景记忆" value={String(epiCount)} hint="流水线完成后自动生成" accent="sky" />
        <MetricCard label="程序记忆" value={String(procCount)} hint="写作风格指令，起草时注入" accent="brand" />
        <MetricCard label="近 7 天新增" value={String(weekNew)} hint="最近一周沉淀条数" accent={weekNew > 0 ? 'emerald' : 'brand'} />
      </div>

      {/* 记忆概览：类型占比 + 增长趋势 + 高频关键词 */}
      {allItems.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="grid md:grid-cols-2 gap-4 mb-3">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">记忆类型占比</div>
              <Donut
                size={110}
                centerValue={String(allItems.length)}
                centerLabel="总记忆"
                segments={[
                  { label: '情景记忆', value: epiCount, color: 'var(--sky-500)' },
                  { label: '程序记忆', value: procCount, color: 'var(--brand-500)' },
                ]}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">记忆增长（按天新增条数）</div>
              {growth.length >= 2 ? (
                <LineChart points={growth} height={120} />
              ) : (
                <ChartEmpty title="数据点不足" hint="再积累几天记忆后展示增长曲线" />
              )}
            </div>
          </div>
          {topKws.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">高频关键词（点击筛选）</div>
              <div className="flex flex-wrap gap-1.5">
                {topKws.map(([kw, n]) => {
                  const t = n / maxKw;
                  const active = q === kw;
                  return (
                    <button
                      key={kw}
                      onClick={() => setQ(active ? '' : kw)}
                      title={`${kw} · 出现 ${n} 次`}
                      className={`rounded-full px-2.5 py-1 transition-colors border ${
                        active
                          ? 'border-teal-400 bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-teal-300'
                      }`}
                      style={{ fontSize: `${11 + t * 4}px`, opacity: 0.55 + t * 0.45, fontWeight: t > 0.7 ? 600 : 400 }}
                    >
                      {kw}
                      <span className="ml-1 text-[11px] text-slate-400">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {showAdd && (
        <Card className="p-4 mb-4 border-teal-200 bg-teal-50/50 card-lift">
          <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-teal-800">
            <Lightbulb size={15} /> 新增程序记忆（写作风格指令）
          </div>
          <Textarea
            placeholder="例：论文写作要求——引言用漏斗式结构；方法节必须写明数据来源与超参数；结论给出未来方向。"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={3}
          />
          <div className="flex items-center gap-2 mt-2">
            <Input placeholder="关键词，逗号分隔（可选）" value={newKeywords} onChange={(e) => setNewKeywords(e.target.value)} />
            <Button onClick={addMemory} disabled={saving || !newContent.trim()}>
              {saving ? <Spinner /> : '保存'}
            </Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              取消
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="py-10 flex justify-center">
          <Spinner label="加载记忆…" />
        </div>
      ) : items.length === 0 ? (
        <>
          <Empty illustration="chat" text="还没有记忆" hint="运行一次全自动流水线会自动沉淀情景记忆；也可以新增写作指令" />
          {/* 空态补一张「记忆从哪来」说明卡，避免用户以为功能坏了 */}
          <Card tone="inset" className="p-4 mt-3">
            <div className="flex items-start gap-2.5">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">两类记忆从哪来</div>
                <ul className="space-y-1">
                  <li>· <span className="font-medium">情景记忆</span>：流水线跑到「完成」时自动写入（主题 / 大纲结构 / 质量分），下一次同类选题会参考。</li>
                  <li>· <span className="font-medium">程序记忆</span>：手写的写作风格指令（如「方法节必须写数据来源」），起草每一章都会注入。</li>
                  <li>· 记忆按<span className="font-medium">项目</span>隔离：切换左侧项目后这里只显示该项目的记忆。</li>
                </ul>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <Card key={m.id} className="p-3.5 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {m.type === 'procedural' ? <Lightbulb size={16} className="text-teal-500" /> : <History size={16} className="text-blue-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={typeTone(m.type)}>{m.type === 'procedural' ? '程序记忆' : '情景记忆'}</Badge>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">{new Date(m.createdAt).toLocaleString()}</span>
                  {m.keywords.map((k) => (
                    <span key={k} className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5">
                      {k}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-all">{m.content}</div>
              </div>
              <button className="text-slate-300 hover:text-rose-500 shrink-0" title="删除" aria-label="删除记忆" onClick={() => remove(m)}>
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </Card>
          ))}
        </div>
      )}

      {/* 删除记忆确认弹窗 */}
      <ConfirmDialog
        open={!!deleting}
        title="删除记忆"
        description={deleting ? `确定要删除这条${deleting.type === 'procedural' ? '程序记忆' : '情景记忆'}吗？删除后无法恢复。` : undefined}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
