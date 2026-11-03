import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Network, Plus, RotateCcw } from 'lucide-react';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import Sigma from 'sigma';
import type { ReferenceGraph } from '../../types';
import { labelPropagation } from './community';
import { Button } from '../../components/ui';

/**
 * ReferenceNetwork — 文献引用网络（sigma.js + graphology，替代 477 行手写 SVG 力导向）。
 * 节点颜色=期刊主题色、大小=被引量；边=共引（细灰） / 去重（红）。
 * 交互：拖拽/滚轮缩放/点击节点回调；工具栏提供放大/缩小/重置视图。
 * 布局：ForceAtlas2（graphology 官方实现）一次性求值后渲染（WebGL，大图可用）。
 */

/**
 * sigma 走 WebGL/canvas，无法直接解析 CSS var()（传进去只会得到黑色），
 * 但主题风格包必须能接管图谱配色 —— 因此在挂载时用 getComputedStyle 把
 * `--viz-series-*` 读成真实色值，并在主题切换（<html> class/data-theme 变化）时重建。
 * 历史上这里写着"两处同步"的字面色值，实际早已与 --viz-series-* 脱节。
 */
const VIZ_VARS = ['--viz-series-1', '--viz-series-2', '--viz-series-3', '--viz-series-4', '--viz-series-5', '--viz-series-6'] as const;

function readVizPalette(): string[] {
  if (typeof document === 'undefined') return ['#47719e', '#be3b2a', '#55743f', '#9a6b2f', '#35707e', '#64748b'];
  const cs = getComputedStyle(document.documentElement);
  const fallback = ['#47719e', '#be3b2a', '#55743f', '#9a6b2f', '#35707e', '#64748b'];
  const colors = VIZ_VARS.map((v, i) => cs.getPropertyValue(v).trim() || fallback[i]);
  return colors;
}

/** 社区配色 = 图表色板 + 补两个色相（8 类社区）；duplicate/muted 边同样从 token 取 */
function buildPalettes() {
  const base = readVizPalette();
  const root = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const read = (name: string, fb: string) => root?.getPropertyValue(name).trim() || fb;
  return {
    venue: base,
    community: [...base, read('--purple', '#9a6b2f'), read('--amber-500', '#f59e0b')],
    dupEdge: read('--rose-500', '#f43f5e'),
    mutedEdge: read('--border', '#cbd5e1'),
    dimmedNode: read('--muted', '#e2e8f0'),
  };
}
const venueColor = (venue: string, palette: string[]): string => {
  let h = 0;
  for (let i = 0; i < venue.length; i++) h = (h * 31 + venue.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
};

export function ReferenceNetwork({ graph, onViewRef }: { graph: ReferenceGraph; onViewRef?: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [query, setQuery] = useState('');
  /** 聚焦某个节点时，高亮它的一跳邻域（其余降透明度） */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** 主题版本号：主题切换时 +1，触发图重建（重读 token 色板） */
  const [themeEpoch, setThemeEpoch] = useState(0);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => setThemeEpoch((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);

  /** 搜索结果：按标题模糊匹配，最多 8 条 */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as { id: string; title: string }[];
    return graph.nodes
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 8)
      .map((n) => ({ id: n.id, title: n.title }));
  }, [query, graph.nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || graph.nodes.length === 0) return;
    const palette = buildPalettes();

    // 1) 构图（graphology）：节点 + 去重合并的边
    const g = new Graph({ multi: false, type: 'directed' });
    for (const n of graph.nodes) {
      if (!g.hasNode(n.id)) {
        g.addNode(n.id, {
          label: `${n.title.slice(0, 48)}${n.title.length > 48 ? '…' : ''}\n${n.venue || '未标注期刊'} · ${n.year ?? 'n.d.'}`,
          size: 4 + Math.min(12, (n.citationCount || 0) / 8),
          color: venueColor(n.venue || '', palette.venue),
          nodeTitle: n.title,
        });
      }
    }
    for (const e of graph.edges) {
      if (!g.hasNode(e.a) || !g.hasNode(e.b) || e.a === e.b) continue;
      if (g.hasEdge(e.a, e.b)) continue;
      g.addEdge(e.a, e.b, {
        color: e.type === 'dup' ? palette.dupEdge : palette.mutedEdge,
        size: e.type === 'dup' ? 2 : Math.min(3, 0.6 + (e.weight || 1) * 0.4),
        edgeType: e.type || 'co-cite',
      });
    }

    // 2) 社区检测（label propagation）：社区用颜色区分，比"按期刊"更能看出研究聚类
    const community = labelPropagation(g);
    const communitySize = new Map<number, number>();
    for (const c of community.values()) communitySize.set(c, (communitySize.get(c) ?? 0) + 1);
    for (const id of g.nodes()) {
      const c = community.get(id) ?? 0;
      g.setNodeAttribute(id, 'community', c);
      g.setNodeAttribute(id, 'color', palette.community[c % palette.community.length]);
      // 大社区略放大，便于一眼看出主干
      const base = g.getNodeAttribute(id, 'size') as number;
      g.setNodeAttribute(id, 'size', base * (1 + Math.min(0.35, (communitySize.get(c) ?? 1) / 40)));
    }

    // 3) ForceAtlas2 布局（迭代次数随规模；Barnes-Hut 大图加速）
    if (g.order > 1) {
      forceAtlas2.assign(g, {
        iterations: Math.min(600, 200 + g.order * 4),
        settings: { gravity: 1, scalingRatio: 12, barnesHutOptimize: g.order > 120, slowDown: 2 },
      });
    } else if (g.order === 1) {
      g.setNodeAttribute(g.nodes()[0], 'x', 0);
      g.setNodeAttribute(g.nodes()[0], 'y', 0);
    }

    // 3) sigma 渲染（WebGL）+ 交互
    const sigma = new Sigma(g, el, {
      settings: {
        renderLabels: true,
        labelDensity: 0.35,
        labelGridCellSize: 90,
        labelRenderedSizeThreshold: 6,
      },
      // sigma v4：nodeReducer 是构造函数顶层选项（不在 settings 里）。
      // 聚焦时把非邻域节点置灰并隐藏标签，突出当前视野。
      nodeReducer: (node, data) => {
        const dimmed = g.getNodeAttribute(node, 'highlighted') === false;
        return dimmed ? { ...data, color: palette.dimmedNode, label: '' } : data;
      },
    });
    sigma.on('clickNode', ({ node }) => onViewRef?.(node));
    sigma.on('enterNode', ({ node }) => {
      el.title = String(g.getNodeAttribute(node, 'nodeTitle') || '');
    });
    sigmaRef.current = sigma;
    graphRef.current = g;

    return () => {
      sigmaRef.current = null;
      graphRef.current = null;
      sigma.kill();
      g.clear();
    };
  }, [graph, onViewRef, themeEpoch]);

  /**
   * 聚焦某个节点：高亮它与其一跳邻居，其余降透明度，并把镜头对准它。
   * sigma v4 的 refresh 是私有的，改完 graph 属性后调用 setSetting 触发重绘。
   */
  const focusOn = (id: string | null) => {
    const g = graphRef.current;
    const sigma = sigmaRef.current;
    if (!g || !sigma) return;
    setFocusId(id);
    if (!id) {
      for (const n of g.nodes()) g.setNodeAttribute(n, 'highlighted', true);
      sigma.setSetting('labelDensity', 0.35);
      sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 300 });
      return;
    }
    const hood = new Set<string>([id, ...g.neighbors(id)]);
    for (const n of g.nodes()) g.setNodeAttribute(n, 'highlighted', hood.has(n));
    sigma.setSetting('labelDensity', 0.9);
    const pos = g.getNodeAttributes(id) as { x?: number; y?: number };
    if (typeof pos.x === 'number' && typeof pos.y === 'number') {
      sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.45 }, { duration: 400 });
    }
  };

  const zoom = (f: number) => {
    const cam = sigmaRef.current?.getCamera();
    if (!cam) return;
    cam.animate({ ratio: cam.getState().ratio / f }, { duration: 200 });
  };
  const reset = () => {
    sigmaRef.current?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 250 });
  };

  return (
    <div className="relative w-full h-[520px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" aria-label="文献引用网络（sigma.js 渲染）" />
      {/* 搜索定位 + 邻域聚焦（F-2.3） */}
      <div className="absolute top-2 left-2 w-56">
        <input
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-2.5 py-1.5 text-xs outline-none focus:border-teal-400"
          placeholder="搜索文献标题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索文献标题以定位节点"
        />
        {matches.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur text-xs">
            {matches.map((m) => (
              <button
                key={m.id}
                className="block w-full text-left px-2 py-1.5 truncate hover:bg-teal-50 dark:hover:bg-teal-900/30"
                onClick={() => focusOn(m.id)}
                title={m.title}
              >
                {m.title}
              </button>
            ))}
          </div>
        )}
        {focusId && (
          <button
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-2 py-1 text-[11px] text-slate-500 hover:text-teal-600"
            onClick={() => focusOn(null)}
          >
            清除聚焦（显示全部）
          </button>
        )}
      </div>

      <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/85 dark:bg-slate-900/85 backdrop-blur rounded-lg border border-slate-200 dark:border-slate-700 p-1">
        <Button variant="ghost" className="px-2 py-1 text-xs" title="放大" onClick={() => zoom(1.35)}>
          <Plus size={12} />
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" title="缩小" onClick={() => zoom(1 / 1.35)}>
          <Minus size={12} />
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" title="重置视图" onClick={reset}>
          <RotateCcw size={12} />
        </Button>
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 bg-white/85 dark:bg-slate-900/85 backdrop-blur rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1">
        <span className="flex items-center gap-1">
          <Network size={10} /> {graph.nodes.length} 文献 · {graph.edges.length} 关系
        </span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-rose-400 inline-block" /> 去重</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-300 inline-block" /> 共引</span>
        <span>节点大小=被引量 · 颜色=研究社区</span>
      </div>
    </div>
  );
}
