import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Options as RemarkRehypeOptions } from "remark-rehype";
import type { Content, Root, Text, PhrasingContent } from "mdast";
import { downloadText } from '../components/ui';

/* ═══════════════════════════════════════════════════════════════════════════
   DocExporter — Markdown → LaTeX / HTML via remark AST pipeline.

   Pipeline overview:
     mdToHtml:  remark-parse → remark-gfm → remark-math → remark-rehype → rehype-stringify
     mdToLatex: remark-parse → remark-gfm → remark-math → custom toLaTeX tree walk

   The old regex-based approach was unreliable for:
     - nested lists spanning multiple indentation levels
     - math delimiters inside code blocks
     - GFM tables with multi-cell rows

   The remark AST makes all of these deterministic.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Utils ──────────────────────────────────────────────────────────────── */

/** Escape special LaTeX characters in plain-text runs. */
function esc(text: string): string {
  return text.replace(/([%_#{}&^~\\])/g, (_, c: string) => {
    if (c === "^") return "\\^{}";
    if (c === "~") return "\\textasciitilde{}";
    if (c === "\\") return "\\textbackslash{}";
    return `\\${c}`;
  });
}

/* ═══════════════════════════════════════════════════════════════════
   mdToHtml — Markdown → HTML

   Pipeline: remark-parse → gfm → math → remark-rehype → stringify
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Configure a Remark → HTML pipeline. We lift math nodes as raw HTML so the
 * client can render them with KaTeX or MathJax.
 */function buildHtmlPipeline() {
  const mathToHtml: Plugin<[], Root> = () => (tree) => {
    const walk = (node: Content | Root) => {
      if (node.type === "math") {
        (node as unknown as { data: Record<string, unknown> }).data = {
          hProperties: { className: "math-block" },
          hName: "div",
          hChildren: [
            { type: "text", value: `$$${(node as unknown as { value: string }).value}$$` },
          ],
        };
      } else if (node.type === "inlineMath") {
        (node as unknown as { data: Record<string, unknown> }).data = {
          hProperties: { className: "math-inline" },
          hName: "span",
          hChildren: [
            { type: "text", value: `$${(node as unknown as { value: string }).value}$` },
          ],
        };
      }
      if ("children" in node && Array.isArray(node.children)) {
        (node.children as (Content | Root)[]).forEach(walk);
      }
    };
    walk(tree);
  };

  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(mathToHtml)
    .use(remarkRehype, { allowDangerousHtml: true } satisfies RemarkRehypeOptions)
    .use(rehypeStringify, { allowDangerousHtml: true });
}

export async function mdToHtml(
  md: string,
  opts?: { includeBib?: boolean },
): Promise<string> {
  const pipeline = buildHtmlPipeline();
  const result = await pipeline.process(md);
  let html = String(result);
  if (opts?.includeBib) {
    html += "\n\n<!-- bibliography -->";
  }
  return html;
}

/** Synchronous variant for callers that cannot await (kept for backwards-compat). */
export function mdToHtmlSync(md: string, opts?: { includeBib?: boolean }): string {
  const pipeline = buildHtmlPipeline();
  const file = pipeline.parse(md);
  const trans = pipeline.runSync(file);
  const result = pipeline.stringify(trans);
  let html = typeof result === "string" ? result : Buffer.from(result).toString("utf8");
  if (opts?.includeBib) {
    html += "\n\n<!-- bibliography -->";
  }
  return html;
}

/* ═══════════════════════════════════════════════════════════════════
   mdToLatex — Markdown → LaTeX (custom AST traversal)

   We parse remark → mdast, then walk the tree producing LaTeX.
   ═══════════════════════════════════════════════════════════════════ */

/** Walk phrasing content (strong, em, code, text, inlineMath, link …) and collect LaTeX. */
function inlineWalk(nodes: PhrasingContent[], out: string[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(esc((node as Text).value));
        break;
      case "strong":
        out.push("\\textbf{");
        inlineWalk((node as unknown as { children: PhrasingContent[] }).children, out);
        out.push("}");
        break;
      case "emphasis":
        out.push("\\textit{");
        inlineWalk((node as unknown as { children: PhrasingContent[] }).children, out);
        out.push("}");
        break;
      case "delete":
        out.push("\\sout{");
        inlineWalk((node as unknown as { children: PhrasingContent[] }).children, out);
        out.push("}");
        break;
      case "inlineCode":
        out.push(`\\texttt{${esc((node as unknown as { value: string }).value)}}`);
        break;
      case "inlineMath":
        out.push(`$${(node as unknown as { value: string }).value}$`);
        break;
      case "link":
        out.push("\\href{");
        out.push(esc((node as unknown as { url: string }).url));
        out.push("}{");
        inlineWalk((node as unknown as { children: PhrasingContent[] }).children, out);
        out.push("}");
        break;
      case "image":
        out.push(`\\includegraphics{${esc((node as unknown as { url: string }).url)}}`);
        break;
      case "break":
        out.push("\\\\\n");
        break;
      case "html":
        /* strip raw HTML in LaTeX */
        break;
      default:
        if ("value" in node && typeof (node as unknown as { value?: string }).value === "string") {
          out.push(esc((node as unknown as { value: string }).value));
        } else if ("children" in node && Array.isArray((node as { children?: unknown }).children)) {
          inlineWalk((node as { children: PhrasingContent[] }).children, out);
        }
    }
  }
}

/** Collect a list of phrasing nodes into a single LaTeX fragment. */
function inlineRender(nodes: PhrasingContent[]): string {
  const buf: string[] = [];
  inlineWalk(nodes, buf);
  return buf.join("");
}

const latexSection = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"] as const;

/** Walk a block-level node and append LaTeX to `out`. */
function blockWalk(node: Content | Root, out: string[], refs?: Map<string, string>): void {
  switch (node.type) {
    case "root": {
      const root = node as Root;
      root.children.forEach((c) => blockWalk(c, out, refs));
      return;
    }
    case "heading": {
      const h = node as unknown as { depth: number; children: PhrasingContent[] };
      const cmd = latexSection[Math.min(h.depth, 4)];
      out.push(`\\${cmd}{${inlineRender(h.children)}}\n\n`);
      return;
    }
    case "paragraph":
      out.push(`${inlineRender((node as unknown as { children: PhrasingContent[] }).children)}\n\n`);
      return;
    case "blockquote": {
      const bq = node as unknown as { children: Content[] };
      out.push("\\begin{quote}\n");
      bq.children.forEach((c) => blockWalk(c, out, refs));
      out.push("\\end{quote}\n\n");
      return;
    }
    case "code": {
      const c = node as unknown as { lang?: string; value: string; meta?: string };
      const lang = c.lang ? `[${c.lang}]` : "";
      // lstlisting is verbatim — do not escape the body.
      out.push(`\\begin{lstlisting${lang}}\n${c.value}\n\\end{lstlisting}\n\n`);
      return;
    }
    case "math": {
      const m = node as unknown as { value: string };
      out.push(`\\begin{equation}\n${m.value}\n\\end{equation}\n\n`);
      return;
    }
    case "list": {
      const list = node as unknown as { ordered?: boolean; start?: number; children: unknown[] };
      const env = list.ordered ? "enumerate" : "itemize";
      out.push(`\\begin{${env}}\n`);
      list.children.forEach((item) => {
        const children = (item as { children: Content[] }).children;
        out.push("\\item ");
        const parts: string[] = [];
        children.forEach((c) => {
          const inner: string[] = [];
          blockWalk(c, inner, refs);
          parts.push(inner.join("").trimEnd());
        });
        out.push(parts.join(" "));
        out.push("\n");
      });
      out.push(`\\end{${env}}\n\n`);
      return;
    }
    case "table": {
      const table = node as unknown as {
        children: Array<{ children: Array<{ children: PhrasingContent[] }> }>;
      };
      const rows = table.children;
      if (!rows.length) return;
      const cols = Math.max(...rows.map((r) => r.children.length));
      const spec = "c".repeat(cols);
      out.push(`\\begin{tabular}{${spec}}\n\\toprule\n`);
      rows.forEach((row, ri) => {
        const cells = row.children.map((cell) => inlineRender(cell.children));
        out.push(cells.join(" & "));
        out.push(" \\\\\n");
        if (ri === 0) out.push("\\midrule\n");
      });
      out.push(`\\bottomrule\n\\end{tabular}\n\n`);
      return;
    }
    case "thematicBreak":
      out.push("\\hrule\n\n");
      return;
    case "html":
      /* strip raw HTML in LaTeX */
      return;
    case "definition":
    case "footnoteDefinition":
      return;
    default:
      if ("children" in node && Array.isArray((node as { children?: unknown }).children)) {
        ((node as { children: Content[] }).children).forEach((c) => blockWalk(c, out, refs));
      } else if ("value" in node && typeof (node as unknown as { value?: string }).value === "string") {
        out.push(esc((node as unknown as { value: string }).value));
      }
  }
}

export function mdToLatex(md: string, refs?: Map<string, string>): string {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(md);
  const out: string[] = [];
  blockWalk(tree, out, refs);
  return out.join("");
}

/* ═══════════════════════════════════════════════════════════════════
   inlineTex / inlineHtml  —  convenience wrappers for single-line conversion
   ═══════════════════════════════════════════════════════════════════ */

export function inlineTex(text: string): string {
  return mdToLatex(text).trim();
}

export function inlineHtml(text: string): string {
  return mdToHtmlSync(text).trim();
}

/* ═══════════════════════════════════════════════════════════════════
   LaTeX document wrapper helpers
   ═══════════════════════════════════════════════════════════════════ */

export function latexDoc(title: string, body: string): string {
  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\usepackage{hyperref}
\\usepackage{booktabs}
\\usepackage{listings}
\\geometry{margin=1in}
\\title{${esc(title)}}
\\begin{document}
\\maketitle
${body}\\end{document}
`;
}

export function htmlDoc(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
body{max-width:880px;margin:3rem auto;font-family:system-ui,sans-serif;line-height:1.7;color:#1a1a1a}
h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .6em}
code,pre{background:#f5f5f5;padding:.1em .35em;border-radius:3px;font-size:.92em}
pre{padding:1em;overflow-x:auto}
blockquote{border-left:3px solid #7c6cf0;margin:1em 0;padding:.1em 1em;color:#555;background:#faf8ff}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #ddd;padding:.4em .8em;text-align:left}
th{background:#f5f5f5}
.math-block{margin:1.5em 0;text-align:center;overflow-x:auto}
.math-inline{display:inline}
hr{border:none;border-top:1px solid #ccc;margin:2em 0}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/* ═══════════════════════════════════════════════════════════════════
   Export helpers (BibTeX kept untouched — references API integration)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Build BibTeX .bib content from a records map.
 * Keys are citation keys, values are already-formatted BibTeX entries.
 * This replaces the old hand-rolled reference formatting — the API
 * integration logic lives elsewhere and returns pre-formatted entries here.
 */
export function buildBibTeX(records: Map<string, string>): string {
  return Array.from(records.values()).join("\n\n");
}

/**
 * Compose a full LaTeX paper with BibTeX references pipeline.
 * This is the call site that fires the references API — keep it
 * dependency-free so it can be extracted into a worker route later.
 */
export async function exportBib(
  title: string,
  bodyMd: string,
  _referenceApi: () => Promise<Map<string, string>>,
): Promise<{ tex: string; bib: string; html: string }> {
  const latexBody = mdToLatex(bodyMd);
  const latex = latexDoc(title, latexBody);

  const refs = await _referenceApi();
  const bib = buildBibTeX(refs);
  const html = htmlDoc(title, mdToHtmlSync(bodyMd, { includeBib: refs.size > 0 }));

  return { tex: latex, bib, html };
}

/* ═══════════════════════════════════════════════════════════════════
   Re-exports for template convenience
   ═══════════════════════════════════════════════════════════════════ */

export { mdToHtmlSync as mdToHtmlSimple };
export { latexDoc as wrapLatexDoc, htmlDoc as wrapHtmlDoc };

/* ═══════════════════════════════════════════════════════════════════
   React component — export buttons panel (lazy-loaded by WritingPage)
   ═══════════════════════════════════════════════════════════════════ */
export interface DocExporterProps {
  doc: { id: string; title: string } | null;
  content: string;
  citations: object[];
  project: { id: string; name?: string };
  onExportFull: () => void;
  onExportWord: () => void;
  aiBusy: boolean;
}

/** 安全文件名（各平台禁止字符统一替换） */
function safeName(title: string, ext: string): string {
  return `${(title || '论文').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
}

/**
 * 导出面板：Markdown / Word 走后端接口（含大纲、引用等完整结构）；
 * LaTeX / HTML 在前端本地转换（mdToLatex / mdToHtmlSync 是纯函数，无需网络）。
 */
export function DocExporter({ doc, content, onExportFull, onExportWord, aiBusy }: DocExporterProps) {
  const title = doc?.title || '论文';
  const hasContent = Boolean(content?.trim());

  const download = (text: string, ext: string, mime: string) => {
    downloadText(safeName(title, ext), text, mime);
  };

  const exportLatex = () => {
    if (!hasContent) return;
    download(latexDoc(title, mdToLatex(content)), 'tex', 'application/x-tex;charset=utf-8');
  };

  const exportHtml = () => {
    if (!hasContent) return;
    download(htmlDoc(title, mdToHtmlSync(content)), 'html', 'text/html;charset=utf-8');
  };

  const btn = 'text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={btn} onClick={onExportFull} disabled={aiBusy}>
        导出 Markdown
      </button>
      <button className={btn} onClick={onExportWord} disabled={aiBusy}>
        导出 Word
      </button>
      <button className={btn} onClick={exportLatex} disabled={aiBusy || !hasContent} title="Markdown → LaTeX(.tex)，本地转换，适合期刊投稿">
        导出 LaTeX
      </button>
      <button className={btn} onClick={exportHtml} disabled={aiBusy || !hasContent} title="Markdown → 独立 HTML（含公式/表格样式），可直接浏览器打开">
        导出 HTML
      </button>
    </div>
  );
}
