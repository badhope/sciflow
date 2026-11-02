import { useMemo } from 'react';
import { ArrowRight, BookOpen, CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';

/**
 * 证据链视图（科研强化）。
 *
 * 论文写作最容易被审稿人质疑的是「这个结论有没有依据」。
 * 这个组件把一条完整链条可视化出来：
 *
 *   研究问题 → 文献依据 → 正文锚点 → 引用记录 → 可溯源条目
 *
 * 每一环的完整度用颜色表达，缺口直接标出来——比如"有锚点但文献库里
 * 找不到对应条目"，这正是伪引用的典型形态。
 *
 * 为什么不用图表库：这是一个**流程链**而不是数值分布，用 Recharts 画反而
 * 丢掉语义（节点是什么、断在哪）。用 DOM + 布局表达更准确，也更好做无障碍。
 */

export type ChainStage = 'question' | 'evidence' | 'anchor' | 'citation' | 'reference';

export interface ChainNode {
  stage: ChainStage;
  label: string;
  /** 该环节的条目数 */
  count: number;
  /** ok=完整, warn=部分缺失, missing=完全缺失 */
  state: 'ok' | 'warn' | 'missing';
  /** 缺口说明（warn/missing 时给用户看） */
  note?: string;
}

interface EvidenceChainProps {
  nodes: ChainNode[];
  /** 点击某环节时的跳转动作（可选） */
  onSelect?: (stage: ChainStage) => void;
  compact?: boolean;
}

const STAGE_META: Record<ChainStage, { icon: typeof BookOpen; title: string; hint: string }> = {
  question: { icon: CircleDashed, title: '研究问题', hint: '这条论证要回答什么' },
  evidence: { icon: BookOpen, title: '文献依据', hint: '支撑它的文献' },
  anchor: { icon: ArrowRight, title: '正文锚点', hint: '正文里的引用标记' },
  citation: { icon: ArrowRight, title: '引用记录', hint: '锚点到文献的映射' },
  reference: { icon: CircleCheck, title: '可溯源条目', hint: '能查到的原始条目' },
};

function stateColor(state: ChainNode['state']): { fg: string; bg: string; ring: string } {
  if (state === 'ok') {
    return {
      fg: 'text-emerald-700 dark:text-emerald-300',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      ring: 'ring-emerald-200 dark:ring-emerald-900',
    };
  }
  if (state === 'warn') {
    return {
      fg: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      ring: 'ring-amber-200 dark:ring-amber-900',
    };
  }
  return {
    fg: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    ring: 'ring-rose-200 dark:ring-rose-900',
  };
}

/** 根据各环节数量推导状态：数量为 0 即断链，前后差异过大则告警 */
export function deriveChainState(nodes: ChainNode[]): ChainNode[] {
  return nodes.map((n, i) => {
    if (n.count === 0) return { ...n, state: 'missing' as const };
    const prev = nodes[i - 1];
    // 上一环节有内容但本环节为 0，已在上面处理；本环节数量少于上一环节说明有断点
    if (prev && prev.count > 0 && n.count < prev.count) {
      return { ...n, state: 'warn' as const, note: n.note ?? `${prev.count - n.count} 项未闭环` };
    }
    return { ...n, state: 'ok' as const };
  });
}

export function EvidenceChain({ nodes, onSelect, compact = false }: EvidenceChainProps) {
  const derived = useMemo(() => deriveChainState(nodes), [nodes]);
  const broken = derived.filter((n) => n.state !== 'ok');

  if (derived.length === 0) return null;

  return (
    <div className="v2-surface overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-[12.5px] font-medium">证据链</span>
        {broken.length === 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CircleCheck size={10} aria-hidden="true" /> 闭环
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <CircleAlert size={10} aria-hidden="true" /> {broken.length} 处断点
          </span>
        )}
      </div>

      <div className={compact ? 'p-2' : 'p-3'}>
        <ol className="flex flex-wrap items-stretch gap-1.5">
          {derived.map((node, i) => {
            const meta = STAGE_META[node.stage];
            const Icon = meta.icon;
            const color = stateColor(node.state);
            return (
              <li key={node.stage} className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => onSelect?.(node.stage)}
                  disabled={!onSelect}
                  title={`${meta.title}：${meta.hint}${node.note ? ` · ${node.note}` : ''}`}
                  className={`v2-focusable flex min-w-[92px] flex-col gap-1 rounded-[var(--r-md)] px-2.5 py-2 text-left ring-1 ${color.bg} ${color.ring} ${
                    onSelect ? 'transition-transform hover:-translate-y-0.5' : 'cursor-default'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <Icon size={11} className={color.fg} aria-hidden="true" />
                    <span className="text-[10.5px] font-medium text-[var(--muted-foreground)]">{meta.title}</span>
                  </span>
                  <span className={`v2-numeric text-[17px] font-semibold leading-none ${color.fg}`}>{node.count}</span>
                  {node.note && (
                    <span className="text-[10px] leading-tight text-[var(--muted-foreground)]">{node.note}</span>
                  )}
                </button>
                {i < derived.length - 1 && (
                  <span className="mx-0.5 grid place-items-center text-[var(--muted-foreground)]" aria-hidden="true">
                    <ArrowRight size={12} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
