import { Loader2, Square } from 'lucide-react';
import type { RevisionQueue, RevisionQueueItem } from '../../types';
import { Badge, Button } from '../../components/ui';

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
}: {
  queue: RevisionQueue;
  stopping: boolean;
  onStop: () => void;
}) {
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
        {active && (
          <Button variant="outline" className="text-xs ml-auto" onClick={onStop} disabled={stopping}>
            {stopping ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
            停止
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {queue.items.map((item, index) => (
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
            </div>
            {item.error && <div className="text-[11px] text-rose-600 dark:text-rose-300 whitespace-pre-wrap">{item.error}</div>}
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
        ))}
      </div>
    </div>
  );
}
