import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/**
 * WritingPreview — Markdown 预览区（含文末参考文献列表渲染）。
 *  - remarkMath + rehypeKatex 渲染 LaTeX 公式
 *  - 按当前引用样式（exportFormat）在文末拼接参考文献列表（exported 数组）
 *  - citations 用于显示引用统计
 */
export function WritingPreview({
  content,
  editorMode,
  exported,
}: {
  content: string;
  editorMode: 'edit' | 'preview' | 'split';
  /** 按当前 exportFormat 渲染的文端参考文献列表（由父级计算：bibtex / 8 种样式） */
  exported: string[];
}) {
  return (
    <div className={`reading-surface flex-1 min-w-0 h-full overflow-y-auto p-6 prose prose-sm prose-headings:font-semibold prose-a:text-teal-600 dark:prose-invert ${editorMode === 'split' ? 'w-1/2' : 'w-full'}`}>
      {content.trim() ? (
        <>
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {content}
          </ReactMarkdown>
          {exported.length > 0 && (
            <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-3">参考文献</h3>
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                {exported.map((e, i) => (
                  <div key={i} className="leading-relaxed">{e}</div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-slate-400 dark:text-slate-500 text-sm">预览区：开始撰写后将实时渲染 Markdown 效果（标题、加粗、引用、列表、代码块等）。</div>
      )}
    </div>
  );
}
