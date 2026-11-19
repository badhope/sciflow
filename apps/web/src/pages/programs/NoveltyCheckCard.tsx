import { useState } from 'react';
import { ArrowRight, ExternalLink, RefreshCw, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Button, Card, Input, errMsg } from '../../components/ui';
import type { NoveltyCheckResult } from '../../types';

const STATUS_META: Record<NoveltyCheckResult['status'], { label: string; tone: 'green' | 'amber' | 'slate' }> = {
  ok: { label: '联网查新完成', tone: 'green' },
  degraded: { label: '部分源不可达', tone: 'amber' },
  offline: { label: '离线降级', tone: 'amber' },
  disabled: { label: '学术检索已关闭', tone: 'slate' },
};

const SOURCE_LABEL: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  arxiv: 'arXiv',
};

/**
 * 选题查新卡片（研究设计页）。
 *
 * 这是「选题 → 投稿」闭环的起点：立项前先判断选题与已有工作的重叠度。
 * 联网不可达时不假装查过，明确展示三源可达性与本地库降级结论。
 */
export function NoveltyCheckCard({
  projectId,
  suggestedTopic,
  onUseTopic,
}: {
  projectId: string;
  suggestedTopic?: string;
  onUseTopic?: (topic: string) => void;
}) {
  const [topic, setTopic] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [result, setResult] = useState<NoveltyCheckResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const text = topic.trim();
    if (!text) {
      setError('请先填写选题');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await api.research.noveltyCheck(projectId, text, searchQuery.trim() || undefined);
      setResult(r);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const meta = result ? STATUS_META[result.status] : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-teal-600" />
            <h3 className="text-sm font-semibold">选题查新</h3>
            <Badge tone="teal">立项前</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            用 OpenAlex / Crossref / arXiv 查相近工作，再结合本项目文献库判断重叠度；境外源不可达时会明确提示代理与本地降级，不会把失败当成「没搜到」。
          </p>
        </div>
        {suggestedTopic ? (
          <Button variant="ghost" size="sm" onClick={() => setTopic(suggestedTopic)} title="填入当前研究计划标题">
            用当前计划标题
          </Button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
        <Input
          placeholder="选题，如：异质图节点分类的鲁棒性"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          aria-label="选题"
        />
        <Input
          placeholder="英文检索词（可选，中文选题建议填）"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="英文检索词"
        />
        <Button onClick={() => void run()} loading={loading} disabled={loading || !topic.trim()}>
          <Search size={14} /> {result ? '重新查新' : '开始查新'}
        </Button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {result && meta && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {result.basis === 'scholar' ? '重叠度' : '本地重叠度'}{' '}
              <b className="text-lg text-slate-800 dark:text-slate-100">{result.overlap}%</b>
            </span>
            <span className="text-[11px] text-slate-400">特异性 {result.specificity} · 命中 {result.hitCount} 条</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <ShieldCheck size={12} /> {result.basis === 'scholar' ? '联网 + 本地比对' : '本地库降级'}
            </span>
          </div>

          {result.notice && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>{result.notice}</span>
            </div>
          )}

          {result.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.sources.map((s) => (
                <span
                  key={s.source}
                  title={s.error || `${s.success} 次成功 / ${s.failed} 次失败`}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    s.ok
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                  }`}
                >
                  {SOURCE_LABEL[s.source] || s.source} {s.ok ? '可达' : '不可达'}
                </span>
              ))}
            </div>
          )}

          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{result.advice}</p>

          {result.similar.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">相近工作</div>
              {result.similar.map((w, i) => (
                <div
                  key={`${w.title}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium" title={w.title}>{w.title}</div>
                    <div className="text-[11px] text-slate-400">
                      {w.year ?? '—'} · {w.venue || '未知来源'} · {w.source}
                      {w.citationCount ? ` · 被引 ${w.citationCount}` : ''}
                    </div>
                  </div>
                  {w.url && (
                    <a
                      href={w.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded p-1 text-slate-400 hover:text-teal-600"
                      title="打开原文"
                      aria-label={`打开 ${w.title}`}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.similar.length === 0 && !result.notice && (
            <p className="mt-2 text-[11px] text-slate-400">本次没有返回相近工作，建议补一个英文检索词再查一次。</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onUseTopic && topic.trim() && (
              <Button size="sm" onClick={() => onUseTopic(topic.trim())}>
                <ArrowRight size={13} /> 以此选题立项
              </Button>
            )}
            {result.status !== 'ok' && (
              <Button variant="outline" size="sm" onClick={() => void run()} loading={loading}>
                <RefreshCw size={13} /> 重试
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
