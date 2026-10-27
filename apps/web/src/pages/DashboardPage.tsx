import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Beaker, FileText, FlaskConical, Gauge, Plus, Workflow, Activity, ChevronDown, Clock3 } from 'lucide-react';
import { api } from '../api/client';
import type { DashboardOverview, Project } from '../types';
import { Button, Card, EmptyState, Skeleton, Badge, jsonText, SectionHeader, SectionTitle, Textarea, errMsg } from '../components/ui';
import { Donut, HBar, MetricCard } from '../components/charts';
import { formatWordCount } from '../lib/format';
import { useContext } from 'react';
import { ToastContext } from '../App';
import type { View } from '../App';

export function DashboardPage({ project, onNavigate, openDoc }: {
  project: Project;
  onNavigate: (v: View) => void;
  openDoc: (id: string) => void;
}) {
  const qc = useQueryClient();
  // 总览数据（React Query）：项目域聚合一次拉齐
  const dashQuery = useQuery({
    queryKey: ['dash', project.id],
    queryFn: async () => {
      const [d, r, k, p] = await Promise.all([
        api.documents.list(project.id),
        api.references.list(project.id),
        api.knowledge.list(project.id).catch(() => [] as never[]),
        api.pipeline.list(project.id).catch(() => [] as never[]),
      ]);
      return { docs: d, refs: r, knowledgeCount: k.length, pipelineCount: p.length };
    },
  });
  const docs = dashQuery.data?.docs ?? [];
  const refs = dashQuery.data?.refs ?? [];
  const knowledgeCount = dashQuery.data?.knowledgeCount ?? 0;
  const pipelineCount = dashQuery.data?.pipelineCount ?? 0;
  const loading = dashQuery.isLoading;
  /** Agent 执行追踪：执行历史 + Token 用量走势（接口未就绪时静默降级为空态） */
  const agentQuery = useQuery({
    queryKey: ['agent-trace', project.id],
    queryFn: async () => {
      const [exec, usage] = await Promise.all([
        api.agent.executions(project.id, 6),
        api.agent.usageTrend(project.id, 14),
      ]);
      return { executions: exec.executions ?? [], trend: usage.trend ?? [] };
    },
    retry: 0,
    refetchInterval: 30000,
  });
  const agentExecs = agentQuery.data?.executions ?? [];
  const agentTrend = agentQuery.data?.trend ?? [];
  const [newTitle, setNewTitle] = useState('');
  /** 科研全链路总览：后端未就绪/失败时为 null，前端降级为小字提示，不白屏 */
  const overviewQuery = useQuery({ queryKey: ['dash-overview', project.id], queryFn: () => api.dashboard.overview(project.id), retry: 0 });
  const overview: DashboardOverview | null = overviewQuery.data ?? null;
  /** 差距#22：项目级系统提示（写作偏好），本地草稿态 */
  const [prefaceDraft, setPrefaceDraft] = useState(project.preface || '');
  const [prefaceEditing, setPrefaceEditing] = useState(false);
  const [prefaceSaving, setPrefaceSaving] = useState(false);
  const toast = useContext(ToastContext);

  const [creatingDoc, setCreatingDoc] = useState(false);
  const createDoc = async () => {
    if (!newTitle.trim() || creatingDoc) return;
    setCreatingDoc(true);
    try {
      const doc = await api.documents.create(project.id, newTitle.trim());
      void qc.invalidateQueries({ queryKey: ['dash', project.id] });
      setNewTitle('');
      toast('success', `草稿「${doc.title}」已创建`);
      openDoc(doc.id);
    } catch (e: unknown) {
      toast('error', errMsg(e) || '创建草稿失败');
    } finally {
      setCreatingDoc(false);
    }
  };

  /** 差距#22：保存项目级系统提示（每轮写作自动注入；注入逻辑在 AI 域，这里只落字段） */
  const savePreface = async () => {
    if (prefaceSaving) return;
    setPrefaceSaving(true);
    try {
      await api.projects.update(project.id, { preface: prefaceDraft.trim() });
      setPrefaceEditing(false);
      toast('success', prefaceDraft.trim() ? '项目写作偏好已保存，后续写作将自动注入' : '已清空项目写作偏好');
    } catch (e: unknown) {
      toast('error', errMsg(e) || '保存失败');
    } finally {
      setPrefaceSaving(false);
    }
  };

  const entries = [
    { label: '论文写作', desc: '大纲 · 起草 · 润色 · 翻译', icon: BookOpen, view: 'writing' as View },
    { label: '文献调研', desc: '多源检索 · 综述 · 文献库', icon: FlaskConical, view: 'literature' as View },
    { label: '实验记录', desc: '本机 Python 沙箱 · 出图留存', icon: Beaker, view: 'experiments' as View },
    { label: '全自动流水线', desc: '主题 → 初稿 → 评分 → 定稿', icon: Workflow, view: 'pipeline' as View },
    { label: '质量评分', desc: '7 维雷达评分与改进建议', icon: Gauge, view: 'quality' as View },
  ];

  return (
    <div className="page-container">
      {/*
        项目抬头（Hero）：原实现是一张塞满东西的大白卡（项目名 + 描述 + 写作偏好设置），
        与下方 4 个指标、全链路、图表、执行追踪完全同权重 —— 首屏没有主次。
        改为两层：上层品牌化抬头（名称 / 元信息 / 两个主操作），下层偏好设置降级为
        <details> 内嵌区（低频配置不该占首屏最贵的位置）。
      */}
      <section className="page-hero mb-6">
        <div className="page-hero__main">
          <div className="min-w-0">
            <div className="page-hero__eyebrow">研究项目</div>
            <h2 className="page-hero__title">{project.name}</h2>
            <p className="page-hero__desc">
              {project.description || '让科研从想法到成文 — 文献、写作、评审与投稿在同一处闭环'}
            </p>
          </div>
          <div className="page-hero__actions">
            <Button onClick={() => onNavigate('pipeline')} title="用主题一键生成初稿">
              <Workflow size={14} /> 运行流水线
            </Button>
            <Button variant="outline" onClick={() => onNavigate('writing')}>
              <BookOpen size={14} /> 继续写作
            </Button>
          </div>
        </div>
        <details className="page-hero__prefs">
          <summary>
            <span className="page-hero__prefs-label">项目写作偏好</span>
            <span className="page-hero__prefs-hint">
              {prefaceDraft.trim() ? '已设置 · 每轮写作自动注入' : '未设置 · 可定义固定写作要求'}
            </span>
            <ChevronDown size={13} className="page-hero__prefs-chevron" aria-hidden="true" />
          </summary>
          <div className="page-hero__prefs-body">
            {prefaceEditing ? (
              <div className="space-y-2">
                <Textarea
                  rows={3}
                  className="text-sm"
                  placeholder="例：本项目要求——引言用漏斗式结构；方法节写明数据来源与超参数；参考文献优先引用近三年中文核心。"
                  value={prefaceDraft}
                  onChange={(e) => setPrefaceDraft(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setPrefaceEditing(false); setPrefaceDraft(project.preface || ''); }}>取消</Button>
                  <Button className="h-7 px-2 text-xs" onClick={savePreface} disabled={prefaceSaving}>
                    {prefaceSaving ? '保存中…' : '保存偏好'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {prefaceDraft.trim() || <span className="text-slate-400 dark:text-slate-500">尚未设置。这是一段固定写作要求，后续每次 AI 写作/润色都会自动带上，等价于轻量「项目记忆」。</span>}
                </div>
                <Button variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => setPrefaceEditing(true)}>
                  {prefaceDraft.trim() ? '编辑' : '设置'}
                </Button>
              </div>
            )}
          </div>
        </details>
      </section>

      {/* 功能入口：原为 5 张等大卡片（与草稿列表争主次，把主任务挤到首屏之外）。
          改为一行紧凑的「分段导航条」——功能一个不少，视觉权重降到辅助层。 */}
      <nav className="page-quicknav mb-6" aria-label="功能入口">
        {entries.map((item) => (
          <button key={item.label} className="page-quicknav__item" onClick={() => onNavigate(item.view)}>
            <item.icon size={14} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 项目数据概览：MetricCard 网格 + 草稿状态分布 */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="论文草稿" value={docs.length} icon={<FileText size={14} />} hint={docs.length ? `${docs.length} 篇进行中` : '尚未创建草稿'} tone="brand" />
        <MetricCard label="参考文献" value={refs.length} icon={<BookOpen size={14} />} hint={refs.length ? '已入库文献' : '文献库为空'} tone="slate" />
        <MetricCard label="知识库资料" value={knowledgeCount} icon={<BookOpen size={14} />} hint="RAG 可问答资料数" tone="slate" />
        <MetricCard label="流水线任务" value={pipelineCount} icon={<Workflow size={14} />} hint="历史全自动任务数" tone="slate" />
      </div>

      {/* 科研全链路：与上方指标同属「项目体征」，用 inset 表面弱化，避免两块白卡并列抢层级 */}
      <Card tone="inset" className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">科研全链路</div>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">待办与卡点一览</span>
        </div>
        {overview === null ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">全链路总览暂不可用（接口未就绪或加载失败）。</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <MiniStat label="待确认大纲" value={overview.pendingOutline} tone="amber" onClick={() => onNavigate('pipeline')} />
              <MiniStat label="超期投稿" value={overview.overdueSubmissions.length} tone="red" onClick={() => onNavigate('submission')} />
              <MiniStat label="待处理审稿意见" value={overview.openReviewComments} tone="amber" />
              <MiniStat
                label="低分文档"
                value={overview.lowQualityDocs.length}
                tone="red"
                onClick={() => overview.lowQualityDocs[0] && openDoc(overview.lowQualityDocs[0].id)}
              />
            </div>
            {overview.overdueSubmissions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-rose-500 dark:text-rose-400">超期投稿</div>
                {overview.overdueSubmissions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-900/10 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{s.journalName} · {s.title}</div>
                      <div className="text-[11px] text-rose-500 dark:text-rose-400">已超 {s.overdueDays} 天 · 建议询问编辑部</div>
                    </div>
                    <Button variant="outline" className="text-xs shrink-0" onClick={() => onNavigate('submission')}>前往投稿</Button>
                  </div>
                ))}
              </div>
            )}
            {overview.lowQualityDocs.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-amber-500 dark:text-amber-400">低分文档</div>
                {overview.lowQualityDocs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{d.title}</div>
                      <div className="text-[11px] text-amber-500 dark:text-amber-400">总分 {d.score} · 建议润色</div>
                    </div>
                    <Button variant="outline" className="text-xs shrink-0" onClick={() => openDoc(d.id)}>前往写作</Button>
                  </div>
                ))}
              </div>
            )}
            {overview.pendingOutline === 0 && overview.overdueSubmissions.length === 0 && overview.lowQualityDocs.length === 0 && overview.openReviewComments === 0 && (
              <div className="text-xs text-slate-400 dark:text-slate-500">暂无卡点，全链路运转正常。</div>
            )}
          </div>
        )}
      </Card>

      {docs.length > 0 && ( /* 草稿状态：与草稿列表同主题，inset 弱化 */
        <Card tone="inset" className="mb-6">
          <SectionHeader title="草稿状态分布" description="按文档状态统计，点击卡片进入写作页" />
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <Donut
              size={132}
              thickness={22}
              centerValue={String(docs.length)}
              centerLabel="草稿总数"
              segments={[
                { label: '草稿', value: docs.filter((d) => d.status === 'draft').length },
                { label: '评审中', value: docs.filter((d) => d.status === 'reviewing').length },
                { label: '已润色', value: docs.filter((d) => d.status === 'polished').length },
                { label: '已定稿', value: docs.filter((d) => d.status === 'final').length },
              ]}
            />
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
              {[
                { label: '草稿', status: 'draft', color: 'var(--viz-series-1)' },
                { label: '评审中', status: 'reviewing', color: 'var(--viz-series-2)' },
                { label: '已润色', status: 'polished', color: 'var(--viz-series-3)' },
                { label: '已定稿', status: 'final', color: 'var(--viz-series-4)' },
              ].map((it) => {
                const n = docs.filter((d) => d.status === it.status).length;
                return (
                  <li key={it.status} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} aria-hidden="true" />
                    {it.label}
                    <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{n}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {/* Agent 执行追踪：观测性信息，用 inset 弱化，不与「草稿」等生产内容同权重 */}
      <Card tone="inset" className="mb-6">
        <SectionHeader
          title={
            <span className="flex items-center gap-1.5">
              <Activity size={13} className="text-teal-600 dark:text-teal-400" aria-hidden="true" /> Agent 执行追踪
            </span>
          }
          description="流水线/多智能体执行历史与 Token 用量走势"
        />
        {agentQuery.isLoading ? (
          <div className="mt-3"><Skeleton className="h-20" /></div>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {/* 最近执行 */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">最近执行</div>
              {agentExecs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-700">
                  暂无执行记录——运行一次流水线后自动沉淀。
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {agentExecs.map((ex) => (
                    <li key={ex.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          ex.status === 'success' ? 'bg-emerald-500' : ex.status === 'failed' ? 'bg-rose-500' : ex.status === 'running' ? 'bg-amber-500 brand-breathe' : 'bg-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{ex.label || ex.source}</span>
                      <span className="shrink-0 text-slate-400">
                        {ex.totalTokens != null ? `${(ex.totalTokens / 1000).toFixed(1)}k tok` : ''}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-slate-400">
                        <Clock3 size={10} aria-hidden="true" />
                        {new Date(ex.startedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* 用量走势 */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">Token 用量（近 14 天）</div>
              {agentTrend.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-700">
                  暂无用量数据——Agent 执行后在此展示 Token 走势。
                </div>
              ) : (
                <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                  <HBar
                    items={agentTrend.map((t) => ({ label: t.date.slice(5), value: t.tokens }))}
                    formatValue={(v) => `${(v / 1000).toFixed(1)}k`}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </Card>


      <SectionTitle
        extra={
          <div className="flex gap-2 w-full sm:w-auto">
            <input
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm w-full sm:w-52 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-50"
              placeholder="新建论文草稿标题"
              aria-label="新建论文草稿标题"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createDoc()}
            />
            <Button onClick={createDoc} disabled={!newTitle.trim()} loading={creatingDoc}>
              <Plus size={15} /> 新建
            </Button>
          </div>
        }
      >
        论文草稿
      </SectionTitle>

      {loading ? (
        <div role="status" aria-label="加载草稿列表" className="grid md:grid-cols-2 gap-3">
          <Card className="p-4"><Skeleton lines={3} /></Card>
          <Card className="p-4"><Skeleton lines={3} /></Card>
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          illustration="documents"
          title="还没有论文草稿"
          hint="新建一篇从空白开始，或到「全自动流水线」用主题一键生成初稿"
          action={
            <Button onClick={() => onNavigate('pipeline')}>
              <Workflow size={14} /> 去生成初稿
            </Button>
          }
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-3 [&>*]:min-w-0">
          {docs.map((d) => {
            const outline = jsonText<{ title: string; sections: { title: string }[] }>(d.outline, { title: '', sections: [] });
            const totalSec = outline.sections?.length || 0;
            const writtenSec = totalSec ? outline.sections.filter((s) => (d.content || '').includes(s.title)).length : 0;
            const words = formatWordCount(d.content?.length || 0);
            return (
              <Card key={d.id} className="p-4 cursor-pointer card-lift hover:border-teal-300 dark:hover:border-teal-700" onClick={() => openDoc(d.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{d.title}</div>
                  <Badge tone={d.status === 'final' ? 'green' : d.status === 'polished' ? 'blue' : 'slate'}>
                    {d.status === 'final' ? '已定稿' : d.status === 'polished' ? '已润色' : '草稿'}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <FileText size={12} /> v{d.version}
                  </span>
                  <span>大纲 {totalSec} 章</span>
                  <span>{words}</span>
                  <span className="w-full sm:w-auto sm:ml-auto">{new Date(d.updatedAt).toLocaleString()}</span>
                </div>
                {totalSec > 0 && (
                  <div className="mt-2.5">
                    <HBar
                      max={totalSec}
                      items={[
                        {
                          label: '写作进度',
                          value: writtenSec,
                          sub: `${writtenSec}/${totalSec} 章`,
                          hint: `v${d.version} · 已写 ${writtenSec}/${totalSec} 章 · ${words}`,
                        },
                      ]}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 全链路待办小卡：可点击跳转对应页面，不可点击时为纯展示 */
function MiniStat({ label, value, tone, onClick }: { label: string; value: number; tone: 'amber' | 'red' | 'slate'; onClick?: () => void }) {
  const toneCls = tone === 'red' ? 'text-rose-600 dark:text-rose-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200';
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`mini-stat ${onClick ? 'is-clickable' : ''}`}
    >
      <div className={`text-xl font-semibold leading-none ${toneCls}`}>{value}</div>
      <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{label}</div>
    </button>
  );
}
