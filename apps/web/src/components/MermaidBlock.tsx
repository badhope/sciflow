import { useEffect, useRef, useState } from 'react';

/**
 * MermaidBlock —— 图表代码块的真实渲染。
 *
 * 背景：流水线「自动配图」生成的是 ```mermaid 代码块，但写作预览此前用
 * ReactMarkdown，没有 mermaid 渲染器 —— 用户看到的是一坨代码，图表价值为 0。
 * 这里用按需动态 import 的方式渲染（mermaid 体积大，绝不进主包）：
 *  - 只有页面里真的出现 mermaid 代码块时才下载 chunk；
 *  - 渲染完成后以 SVG 内联展示，跟随主题色（theme 由 data-theme/.dark 决定）；
 *  - 语法错误不炸页面：显示原始代码 + 错误提示（学术写作场景里宁可看到源码）。
 */

type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => (m.default ?? m) as unknown as MermaidApi);
  }
  return mermaidPromise;
}

/** 当前主题是否为深色（mermaid 需要 'dark' theme 才能出可读配色） */
function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function brandFontFamily(): string {
  if (typeof document === 'undefined') return 'sans-serif';
  return getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
}

function brandAccent(): string {
  if (typeof document === 'undefined') return '#0f9e94';
  return getComputedStyle(document.documentElement).getPropertyValue('--brand-500').trim() || '#0f9e94';
}

let seq = 0;

export function MermaidBlock({ code, className = '' }: { code: string; className?: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [dark, setDark] = useState<boolean>(() => isDark());
  const idRef = useRef(`sf-mmd-${++seq}`);
  /** 渲染结果与输入绑定：代码或明暗变化后，旧 SVG/旧错误不再展示（避免 effect 内 setState 清状态） */
  const renderKey = `${dark ? 'd' : 'l'}:${code}`;
  const [renderedKey, setRenderedKey] = useState('');
  const visibleSvg = renderedKey === renderKey ? svg : '';
  const visibleError = error?.key === renderKey ? error.message : '';

  // 跟随明暗/风格切换重绘：主题变化时观察 <html> 的 class 与 data-theme
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          // 深色用 dark，浅色用 base + 品牌色变量，避免默认配色（紫/黄）与设计系统冲突
          theme: dark ? 'dark' : 'base',
          securityLevel: 'strict',
          fontFamily: brandFontFamily(),
          themeVariables: dark
            ? { primaryColor: '#0d1520', primaryTextColor: '#d6e4f0', primaryBorderColor: brandAccent(), lineColor: brandAccent() }
            : { primaryColor: '#ffffff', primaryTextColor: '#1c2a44', primaryBorderColor: brandAccent(), lineColor: brandAccent() },
        });
        const { svg: out } = await mermaid.render(idRef.current, code);
        if (!cancelled) {
          setSvg(out);
          setError(null);
          setRenderedKey(renderKey);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSvg('');
          setError({ key: renderKey, message: e instanceof Error ? e.message : String(e) });
          setRenderedKey(renderKey);
        }
      });
    return () => { cancelled = true; };
  }, [code, dark, renderKey]);

  if (visibleError) {
    return (
      <div className={`my-3 overflow-hidden rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30 ${className}`}>
        <div className="border-b border-amber-200 px-3 py-1.5 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-300">
          图表渲染失败（保留源码，可复制到 mermaid.live 排查）：{visibleError.slice(0, 160)}
        </div>
        <pre className="overflow-x-auto px-3 py-2 text-[12px] leading-relaxed text-slate-700 dark:text-slate-200"><code>{code}</code></pre>
      </div>
    );
  }

  if (!visibleSvg) {
    return (
      <div className={`my-3 flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500 ${className}`} role="status">
        图表渲染中…
      </div>
    );
  }

  return (
    <div
      className={`mermaid-figure my-3 flex justify-center overflow-x-auto rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40 ${className}`}
      // mermaid 输出的是受 securityLevel:'strict' 清洗过的 SVG（无脚本、无事件属性）
      dangerouslySetInnerHTML={{ __html: visibleSvg }}
    />
  );
}

export default MermaidBlock;
