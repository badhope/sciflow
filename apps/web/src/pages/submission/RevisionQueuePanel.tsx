import { useState } from 'react';
import { CheckCircle2, History, Loader2, RotateCcw, Square } from 'lucide-react';
import type { RevisionQueue, RevisionQueueItem, RevisionQueueSummary } from '../../types';
import { Badge, Button, Select } from '../../components/ui';

const STATUS_LABEL: Record<RevisionQueue['status'], string> = {
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  partial: '部分完成',
  failed: '全部失败',
  stopped: '已停止',
};

const ITEM_LABEL: Record<RevisionQueueItem['status'], string> = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  skipped: '跳过',
};

function queueTone(status: RevisionQueue['status']): 'slate' | 'green' | 'amber' | 'red' | 'blue' {
  if (status === 'completed') return 'green';
  if (status === 'partial') return 'amber';
  if (status === 'failed') return 'red';
  if (status === 'stopped') return 'slate';
  return 'blue';
}

function itemTone(status: RevisionQueueItem['status']): 'slate' | 'green' | 'amber' | 'red' | 'blue' {
  if (status === 'done') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'skipped') return 'slate';
  if (status === 'running') return 'blue';
  return 'amber';
}

/** 修改计划执行队列：整体进度 + 逐条 before/after，停止只影响未开始条目 */
export function RevisionQueuePanel({
  queue,
  stopping,
  onStop,
  sectionTitles = [],
  onRetry,
  retryingItemId = null,
}: {
  queue: RevisionQueue;
  stopping: boolean;
  onStop: () => void;
  sectionTitles?: string[];
  onRetry?: (item: RevisionQueueItem, sectionTitle: string) => void;
  retryingItemId?: string | null;
}) {
  const [retryTitles, setRetryTitles] = useState<Record<string, string>>({});
  const executable = queue.items.filter((item) => item.status !== 'skipped');
  const finished = executable.filter((item) => item.status === 'done' || item.status === 'failed');
  const done = executable.filter((item) => item.status === 'done').length;
  const failed = executable.filter((item) => item.status === 'failed').length;
  const active = queue.status === 'queued' || queue.status === 'running';

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-slate-50/60 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">执行队列</span>
        <Badge tone={queueTone(queue.status)}>{STATUS_LABEL[queue.status]}</Badge>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {finished.length}/{executable.length} 条已处理{done > 0 ? `，成功 ${done}` : ''}{failed > 0 ? `，失败 ${failed}` : ''}
        </span>
        {queue.autoResolve && (
          <Badge tone="teal">
            <CheckCircle2 size={11} className="mr-0.5 inline" />
            自动关闭审稿意见
          </Badge>
        )}
        {queue.resolvedCommentIds.length > 0 && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">已关闭 {queue.resolvedCommentIds.length} 条意见</span>
        )}
        {active && (
          <Button variant="outline" className="text-xs ml-auto" onClick={onStop} disabled={stopping}>
            {stopping ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
            停止
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {queue.items.map((item, index) => {
          const canRetry = (item.status === 'skipped' || item.status === 'failed') && sectionTitles.length > 0 && onRetry;
          const picked = retryTitles[item.id] || (item.sectionTitle && sectionTitles.includes(item.sectionTitle) ? item.sectionTitle : '');
          return (
            <div key={item.id || index} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-[11px] text-slate-500">{item.planItemId || `#${index + 1}`}</span>
                {item.sectionTitle ? (
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">「{item.sectionTitle}」</span>
                ) : (
                  <span className="text-xs text-slate-400">未匹配章节</span>
                )}
                <Badge tone={itemTone(item.status)}>
                  {item.status === 'running' && <Loader2 size={11} className="inline animate-spin mr-1" />}
                  {ITEM_LABEL[item.status]}
                </Badge>
                {item.status === 'done' && item.changed && <Badge tone="teal">正文有变化</Badge>}
                {item.commentResolved && <Badge tone="green">审稿意见已关闭</Badge>}
              </div>
              {item.error && <div className="text-[11px] text-rose-600 dark:text-rose-300 whitespace-pre-wrap">{item.error}</div>}
              {canRetry && (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="shrink-0 text-[11px] text-slate-400">指定章节重试</span>
                  <Select
                    className="text-xs flex-1 !py-1"
                    ariaLabel={`${item.planItemId || '条目'} 重试章节`}
                    options={[
                      { value: '', label: '选择章节…' },
                      ...sectionTitles.map((title) => ({ value: title, label: title })),
                    ]}
                    value={picked}
                    onChange={(value) => setRetryTitles((m) => ({ ...m, [item.id]: value }))}
                  />
                  <Button
                    variant="outline"
                    className="text-xs shrink-0"
                    onClick={() => onRetry(item, picked)}
                    disabled={!picked || retryingItemId === item.id}
                  >
                    {retryingItemId === item.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    重试
                  </Button>
                </div>
              )}
              {(item.before || item.after) && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 select-none">
                    查看逐条 diff
                  </summary>
                  <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
                    <div>
                      <div className="text-slate-400 mb-0.5">修改前</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-rose-50 dark:bg-rose-950/20 p-2 text-slate-600 dark:text-slate-300">{item.before || '（空）'}</pre>
                    </div>
                    <div>
                      <div className="text-slate-400 mb-0.5">修改后</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-emerald-50 dark:bg-emerald-950/20 p-2 text-slate-600 dark:text-slate-300">{item.after || '（空）'}</pre>
                    </div>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 历史队列：只读审计条，不展开 before/after，避免历史记录压垮页面。 */
export function RevisionQueueHistory({ queues }: { queues: RevisionQueueSummary[] }) {
  if (queues.length === 0) return null;
  return (
    <details className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 select-none">
        <History size={13} aria-hidden="true" />
        历史队列（{queues.length}）
        <span className="ml-auto text-[10px] font-normal text-slate-400">最近 20 队 · 只读审计</span>
      </summary>
      <div className="space-y-1 border-t border-slate-100 px-2 py-2 dark:border-slate-800">
        {queues.map((q) => (
          <div key={q.id} className="flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <Badge tone={queueTone(q.status)}>{STATUS_LABEL[q.status]}</Badge>
            <span className="v2-numeric text-slate-400">{new Date(q.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-slate-500 dark:text-slate-400">
              成功 {q.done}/{q.total}{q.failed > 0 ? ` · 失败 ${q.failed}` : ''}{q.skipped > 0 ? ` · 跳过 ${q.skipped}` : ''}
              {q.changed > 0 ? ` · 改动 ${q.changed}` : ''}
            </span>
            {q.resolvedComments > 0 && <Badge tone="green">关闭意见 {q.resolvedComments}</Badge>}
          </div>
        ))}
      </div>
    </details>
  );
}
