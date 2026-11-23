import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { marked } from 'marked';
import katex from 'katex';

const PRINT_CSS = `
  @page { size: A4; margin: 20mm 18mm 22mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, serif;
    font-size: 11.5pt; line-height: 1.75; color: #1f2937; }
  h1 { font-size: 20pt; text-align: center; margin: 0 0 8mm; letter-spacing: .02em; }
  h2 { font-size: 14pt; margin: 7mm 0 3mm; border-bottom: 1px solid #d1d5db; padding-bottom: 1.5mm; page-break-after: avoid; }
  h3 { font-size: 12pt; margin: 5mm 0 2mm; page-break-after: avoid; }
  p { margin: 0 0 2.6mm; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 1.4mm 2mm; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 2.5mm; font-size: 9pt;
    white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
  code { font-family: "JetBrains Mono", Consolas, monospace; font-size: 9.5pt; }
  blockquote { margin: 2mm 0; padding: 1mm 3mm; border-left: 3px solid #94a3b8; color: #475569; }
  img { max-width: 100%; }
  .math-block { text-align: center; margin: 3mm 0; page-break-inside: avoid; }
  .refs { font-size: 9.5pt; }
  .refs li { margin-bottom: 1.6mm; text-indent: -1.2em; padding-left: 1.2em; }
  a { color: #0f766e; text-decoration: none; }
`;

@Injectable()
export class PdfExportService {
  private readonly logger = new Logger(PdfExportService.name);
  private browserPromise?: Promise<Browser>;

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/local/bin/chromium';
      this.browserPromise = chromium.launch({
        ...(existsSync(executablePath) ? { executablePath } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return this.browserPromise;
  }

  /** Markdown → 可打印 HTML；公式用 KaTeX MathML，避免额外字体依赖。 */
  renderMarkdown(markdown: string): string {
    let html = markdown;
    html = html.replace(/```([\s\S]*?)```/g, (m) => m);
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
      try {
        return `<div class="math-block">${katex.renderToString(tex, { displayMode: true, output: 'mathml', throwOnError: false })}</div>`;
      } catch { return `<pre>${tex}</pre>`; }
    });
    html = html.replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => {
      try {
        return katex.renderToString(tex, { displayMode: false, output: 'mathml', throwOnError: false });
      } catch { return tex; }
    });
    return marked.parse(html, { gfm: true, breaks: false, async: false }) as string;
  }

  async renderPdf(input: { title: string; html: string; footer?: string }): Promise<Buffer> {
    if (!input.html.trim()) throw new Error('没有可导出的正文');
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title><style>${PRINT_CSS}</style></head><body>${input.html}</body></html>`, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `<div style="width:100%;font-size:8px;color:#94a3b8;text-align:center;font-family:sans-serif">${escapeHtml(input.footer || 'SciFlow')} · <span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
        margin: { top: '20mm', bottom: '22mm', left: '18mm', right: '18mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async dispose() {
    const p = this.browserPromise;
    this.browserPromise = undefined;
    if (p) await p.then((b) => b.close()).catch(() => undefined);
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
