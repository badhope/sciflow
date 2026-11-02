import { useEffect, useRef } from 'react';
import { BookOpen, FileText, Library } from 'lucide-react';

/**
 * `@` 上下文提及（harness 能力）。
 *
 * 对标 Cursor / Claude Code 的 @file：用户不必描述"我指的是哪篇文献"，
 * 直接在输入里 @ 一下，把该对象的正文/摘要注入本轮上下文。
 *
 * 设计要点：
 *  - 只在 `@` 出现在词首时触发，避免邮箱、代码里的 @ 误触；
 *  - 键盘完全可用（↑↓ 选择、Enter 确认、Esc 关闭），不强制鼠标；
 *  - 选中后只插入一个轻量标记 `@文献名`，真正的正文在提交时由调用方注入，
 *    避免输入框里塞进整段正文导致无法编辑。
 */

export type MentionKind = 'reference' | 'knowledge' | 'document';

export interface MentionItem {
  id: string;
  kind: MentionKind;
  label: string;
  hint?: string;
}

interface MentionPickerProps {
  items: MentionItem[];
  onPick: (item: MentionItem) => void;
  onClose: () => void;
  activeIndex: number;
  onActiveChange: (i: number) => void;
}

const KIND_META: Record<MentionKind, { icon: typeof FileText; text: string }> = {
  reference: { icon: BookOpen, text: '文献' },
  knowledge: { icon: Library, text: '资料' },
  document: { icon: FileText, text: '文档' },
};

export function MentionPicker({ items, onPick, onClose, activeIndex, onActiveChange }: MentionPickerProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // 键盘移动时把选中项滚进视野（否则长列表里看不到当前选中）
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="插入上下文"
      className="v2-surface absolute bottom-full left-0 z-30 mb-1.5 max-h-64 w-full max-w-md overflow-y-auto p-1"
    >
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        插入上下文
      </div>
      {items.map((item, i) => {
        const meta = KIND_META[item.kind];
        const Icon = meta.icon;
        const active = i === activeIndex;
        return (
          <button
            key={`${item.kind}-${item.id}`}
            type="button"
            role="option"
            aria-selected={active}
            data-idx={i}
            onMouseEnter={() => onActiveChange(i)}
            onClick={() => onPick(item)}
            className={`flex w-full items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left transition-colors ${
              active ? 'bg-[var(--accent)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_50%,transparent)]'
            }`}
          >
            <Icon size={13} className="shrink-0 text-[var(--brand-600)]" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.label}</span>
            <span className="shrink-0 text-[10.5px] text-[var(--muted-foreground)]">
              {item.hint ?? meta.text}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onClose}
        className="mt-1 w-full rounded-[var(--r-sm)] px-2 py-1 text-center text-[11px] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
      >
        关闭（Esc）
      </button>
    </div>
  );
}

/**
 * 从输入文本里解析当前正在输入的 @ 查询。
 * 返回 null 表示没有处于 mention 状态。
 */
export function parseMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // 词首校验：@ 必须在开头或前面是空白
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  // 查询里出现空白说明已经结束 mention
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

/** 把 @ 查询替换为选中项的标签，返回新文本与光标位置 */
export function applyMention(text: string, start: number, caret: number, label: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret);
  const token = `@${label} `;
  return { text: `${before}${token}${after}`, caret: before.length + token.length };
}

/** 从最终文本里抽出被 @ 的标签（提交时据此注入真实上下文） */
export function extractMentions(text: string): string[] {
  const found: string[] = [];
  // 标签边界：空白、行尾，或中英文标点（中文写作里 @ 后面常直接跟逗号）
  const re = /(^|\s)@([^\s@，,。.；;：:、！!？?（）()【】\[\]"'`]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!found.includes(m[2])) found.push(m[2]);
  }
  return found;
}

/** 过滤候选：按标签模糊匹配，最多返回 limit 条 */
export function filterMentions(items: MentionItem[], query: string, limit = 8): MentionItem[] {
  const q = query.trim().toLowerCase();
  const matched = q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;
  return matched.slice(0, limit);
}
