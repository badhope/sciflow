import { AlertTriangle, Check, ShieldQuestion, X } from 'lucide-react';

/**
 * 工具审批对话框（harness 界面）。
 *
 * 对标 Claude Code / Codex 的权限确认。设计要点：
 *  - 说清「要做什么 / 为什么 / 影响什么」，而不是只丢一个工具名；
 *  - 拒绝比批准更容易点（安全默认），且拒绝不报错、给模型可用的替代路径；
 *  - 一次只问一件事，不做"全部批准"批量按钮（那等于没有审批）。
 */

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: number;
}

interface ApprovalDialogProps {
  request: ApprovalRequest | null;
  onDecide: (id: string, approved: boolean) => void;
  busy?: boolean;
}

/** 把工具名翻译成人能读的动作描述 */
function humanizeTool(toolName: string): string {
  const map: Record<string, string> = {
    'experiment.run': '在本机运行代码',
    'document.update': '修改论文正文',
    'document.delete': '删除文档',
    'project.delete': '删除项目',
    'project.update': '修改项目设置',
    'config.write': '修改全局配置',
    'config.set_permission': '修改权限策略',
    'extension.create': '创建扩展资产',
  };
  if (map[toolName]) return map[toolName];
  const prefix = toolName.split('.')[0];
  const prefixMap: Record<string, string> = {
    experiment: '执行实验相关操作',
    document: '修改文档',
    project: '修改项目',
    config: '修改配置',
  };
  return prefixMap[prefix] ?? `执行 ${toolName}`;
}

export function ApprovalDialog({ request, onDecide, busy = false }: ApprovalDialogProps) {
  if (!request) return null;

  let parsedArgs = '';
  try {
    const obj = JSON.parse(request.args || '{}');
    const keys = Object.keys(obj);
    if (keys.length) {
      parsedArgs = JSON.stringify(obj, null, 2);
      if (parsedArgs.length > 800) parsedArgs = `${parsedArgs.slice(0, 800)}\n…`;
    }
  } catch {
    parsedArgs = request.args;
  }

  return (
    <div
      className="overlay-in fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
    >
      <div className="modal-in w-full max-w-lg overflow-hidden rounded-[var(--r-lg)] bg-[var(--card)] shadow-[var(--depth-4)]">
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--r-md)] bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <ShieldQuestion size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="approval-title" className="text-[15px] font-semibold">
              需要你的确认
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--muted-foreground)]">
              AI 想执行一个会产生副作用的操作
            </p>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">操作</div>
            <div className="mt-1 text-[13.5px] font-medium">{humanizeTool(request.toolName)}</div>
            <code className="mt-0.5 block font-[var(--font-mono)] text-[11.5px] text-[var(--muted-foreground)]">
              {request.toolName}
            </code>
          </div>

          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">原因</div>
            <div className="mt-1 flex items-start gap-1.5 text-[13px] leading-relaxed">
              <AlertTriangle size={13} className="mt-1 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>{request.reason || '该操作会产生副作用。'}</span>
            </div>
          </div>

          {parsedArgs && (
            <details className="v2-disclosure rounded-[var(--r-sm)] bg-[var(--muted)]/50">
              <summary className="px-2.5 py-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                查看参数
              </summary>
              <pre className="max-h-40 overflow-auto px-2.5 pb-2 font-[var(--font-mono)] text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                {parsedArgs}
              </pre>
            </details>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(request.id, false)}
            className="v2-focusable inline-flex items-center gap-1.5 rounded-[var(--r-sm)] px-3 py-1.5 text-[13px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <X size={13} aria-hidden="true" />
            拒绝
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(request.id, true)}
            className="v2-focusable inline-flex items-center gap-1.5 rounded-[var(--r-sm)] bg-[var(--brand-grad)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--on-brand)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check size={13} aria-hidden="true" />
            允许执行
          </button>
        </div>
      </div>
    </div>
  );
}
