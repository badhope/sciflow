import { forwardRef, ReactNode, useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Loader2, Sparkles, X, XCircle } from 'lucide-react';
import { EmptyDocuments, EmptySearch, EmptyChat, EmptyKnowledge, EmptyPipeline } from './illustrations';

const ILLUSTRATIONS = {
  documents: EmptyDocuments,
  search: EmptySearch,
  chat: EmptyChat,
  knowledge: EmptyKnowledge,
  pipeline: EmptyPipeline,
} as const;

type IllustrationKey = keyof typeof ILLUSTRATIONS;

const btnBase =
  'inline-flex items-center justify-center gap-1.5 font-medium transition-[background,color,border-color,box-shadow,transform] duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none whitespace-nowrap active:scale-[0.98] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--background)]';

/** 三档尺寸：xs(24) / sm(32) / md(38)。移动端热区由 padding 撑到 ≥32，图标按钮请用 IconButton。 */
const btnSizes = {
  xs: 'h-6 px-2 text-[12px] rounded-md gap-1',
  sm: 'h-8 px-2.5 text-[13px] rounded-md',
  md: 'h-[38px] px-3.5 text-sm rounded-lg',
} as const;

export type ButtonSize = keyof typeof btnSizes;

export function Button({
  children, variant = 'primary', size = 'md', className = '', disabled, onClick, title, loading, type = 'button', ariaLabel, fullWidth,
}: {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'success' | 'subtle';
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  loading?: boolean;
  type?: 'button' | 'submit';
  ariaLabel?: string;
  fullWidth?: boolean;
}) {
  const variants: Record<string, string> = {
    primary: 'brand-btn',
    ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
    subtle: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/20',
    outline: 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 bg-[var(--card)]',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20',
  };
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={`${btnBase} ${btnSizes[size]} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading && <Loader2 size={size === 'xs' ? 12 : 14} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** 图标按钮：保证 ≥32×32 热区（移动端可点），必须给 ariaLabel。 */
export function IconButton({
  icon, label, onClick, size = 32, tone = 'slate', disabled, title, className = '',
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  size?: 28 | 32 | 36 | 40;
  tone?: 'slate' | 'danger' | 'brand';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const tones = {
    slate: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
    danger: 'text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-300',
    brand: 'text-slate-400 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-900/30 dark:hover:text-teal-300',
  } as const;
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${tones[tone]} ${className}`}
    >
      {icon}
    </button>
  );
}

export function Card({ children, className = '', onClick, hover, padded = true, as = 'div', id }: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
  /** 默认给 16px 内边距；需要自定义布局时传 false */
  padded?: boolean;
  as?: 'div' | 'section' | 'article';
  /** 锚点 id（设置页/文档页内导航用） */
  id?: string;
}) {
  const Tag = as;
  return (
    <Tag
      id={id}
      onClick={onClick}
      className={`bg-[var(--card)] text-[var(--card-foreground)] rounded-[var(--r-md)] border border-slate-200/80 dark:border-slate-800 shadow-[var(--sh-card)] ${padded ? 'p-4' : ''} ${hover ? 'card-lift cursor-pointer' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}

/** 区块标题：全站统一的信息层级（标题 / 描述 / 右侧操作） */
export function SectionHeader({ title, description, actions, level = 2, className = '' }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <div className={`flex flex-wrap items-start justify-between gap-2 ${className}`}>
      <div className="min-w-0">
        <Tag className={`${level === 2 ? 'text-[15px]' : 'text-sm'} font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate`}>{title}</Tag>
        {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** 空态：插图 + 标题 + 说明 + 主操作（缺一不可，避免"只有一行字"） */
export function EmptyState({ title, hint, illustration, action, compact }: {
  title: string;
  hint?: string;
  illustration?: IllustrationKey;
  action?: ReactNode;
  compact?: boolean;
}) {
  const IllustrationComp = illustration ? ILLUSTRATIONS[illustration] : null;
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-14'} px-6`}>
      {IllustrationComp ? (
        <IllustrationComp className="w-24 h-20 mb-2 opacity-90" />
      ) : (
        <div className="w-11 h-11 rounded-[var(--r-md)] brand-logo flex items-center justify-center mb-2">
          <Sparkles size={19} aria-hidden="true" />
        </div>
      )}
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm outline-none transition-all duration-150 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:focus:ring-teal-400/15 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600 ${props.className || ''}`}
    />
  );
}

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea(props, ref) {
    const { className, ...rest } = props;
    return (
      <textarea
        ref={ref}
        {...rest}
        className={`w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm outline-none transition-all duration-150 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:focus:ring-teal-400/15 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600 resize-none leading-relaxed ${className || ''}`}
      />
    );
  },
);

export function Select({ options, value, onChange, className = '' }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 outline-none transition-all duration-150 focus:border-teal-500 hover:border-slate-400 dark:hover:border-slate-600 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'teal' | 'blue' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
    green: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    amber: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    red: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
    teal: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
    blue: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm py-2">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      <span>{label || '处理中…'}</span>
    </div>
  );
}

export function Skeleton({ className = '', lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`skeleton h-3.5 ${className}`} style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ text, hint, illustration }: { text: string; hint?: string; illustration?: IllustrationKey }) {
  const IllustrationComp = illustration ? ILLUSTRATIONS[illustration] : null;
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 text-center py-12">
      {IllustrationComp ? (
        <IllustrationComp className="w-24 h-20 mb-2" />
      ) : (
        <div className="w-11 h-11 rounded-xl brand-logo flex items-center justify-center mb-1">
          <Sparkles size={19} className="text-white" />
        </div>
      )}
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{text}</div>
      {hint && <div className="text-xs text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

export function Modal({ open, title, children, onClose, width = 'max-w-2xl' }: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  /** 无障碍 + 键盘：Esc 关闭、Tab 焦点陷阱、关闭后归还焦点（与 ShellDrawer 同一套语义） */
  useEffect(() => {
    if (!open) return;
    const restore = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    const raf = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, button:not([disabled]), a[href]');
      first?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 backdrop-blur-[2px] p-4 pt-16 overflow-y-auto overlay-in" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-[var(--card)] rounded-xl shadow-2xl w-full ${width} p-5 modal-in border border-slate-200 dark:border-slate-700`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id={titleId} className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label="关闭对话框">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Type guard: narrow unknown to { message: string } */
function isErrorWithMessage(e: unknown): e is { message: string } {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string';
}

/** 统一错误提取：后端 Nest 错误（message）与前端 Error 统一取可读信息 */
export function errMsg(e: unknown): string {
  if (isErrorWithMessage(e)) return e.message;
  return String(e);
}

/** 可折叠卡片（渐进披露）：默认折叠只显示标题+摘要，点击展开内容 */
export function CollapsibleCard({
  icon,
  title,
  summary,
  open,
  onToggle,
  children,
  right,
}: {
  icon: ReactNode;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Card className="p-5 mt-4">
      <button className="w-full flex items-center justify-between text-left" onClick={onToggle}>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          {icon}
          {title}
          {summary ? <span className="text-[11px] font-normal text-slate-400">{summary}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          {right}
          {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </span>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  // 窄屏：标题与右侧操作纵向堆叠（sm+ 恢复原左右布局，桌面端不变）
  return (
    <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{children}</h2>
      {extra}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return <div role="alert" aria-live="assertive" className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2"><XCircle size={14} className="shrink-0" aria-hidden="true" /><span>{message}</span></div>;
}

/** 危险/普通确认弹窗：替代原生 window.confirm，与设计系统一致的二次确认（含 loading 态） */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Modal open={open} title={title} onClose={onClose} width="max-w-md">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${danger ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-500' : 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'}`}>
          <AlertTriangle size={18} />
        </span>
        {description && <div className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed pt-1.5">{description}</div>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * 宽松 JSON 取值：入参存在两种形态——DB 原样回传的 JSON 字符串，
 * 以及部分接口（如 /api/quality/latest）已 parseJson 过的对象。
 * 两者都要能取，否则对象入参会命中 `raw.trim is not a function` 运行时崩溃。
 */
export function jsonText<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw as T;
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ---------- 文件下载公共工具（base64 二进制 / 文本，各页面导出复用） ---------- */
export function downloadBase64(filename: string, base64: string, mime: string) {
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- 全局 Toast 反馈系统（品牌交互层） ---------- */
export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  leaving?: boolean;
}

export function ToastViewport({ items, onDone }: { items: ToastItem[]; onDone: (id: number) => void }) {
  const icons: Record<ToastKind, ReactNode> = {
    success: <CheckCircle2 size={15} className="text-emerald-500" />,
    error: <XCircle size={15} className="text-rose-500" />,
    info: <Info size={15} className="text-teal-500" />,
  };
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg px-3.5 py-2.5 text-sm text-slate-700 dark:text-slate-200 border-l-[3px] ${
            t.kind === 'success' ? 'border-l-emerald-500' : t.kind === 'error' ? 'border-l-rose-500' : 'border-l-teal-500'
          } ${t.leaving ? 'toast-out' : 'toast-in'}`}
        >
          {icons[t.kind]}
          <span>{t.text}</span>
          <button className="text-slate-400 hover:text-slate-600 ml-1" onClick={() => onDone(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
