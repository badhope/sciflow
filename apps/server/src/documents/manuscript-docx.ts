import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph } from 'docx';
import { parseAuthors } from '../common/authors';
import { DEFAULT_SUBMISSION_TEMPLATE, parseSubmissionTemplate, type SubmissionTemplateStyle } from '../research/submission-templates';

export interface ManuscriptOutline {
  title: string;
  sections: { title: string; subsections: string[] }[];
}

export interface ManuscriptReference {
  title: string;
  authors: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
}

export interface ManuscriptFigure {
  data: Buffer;
  caption: string;
  name?: string;
}

export interface ManuscriptDocxInput {
  title: string;
  outline: ManuscriptOutline;
  content: string;
  refs: ManuscriptReference[];
  /** 排版模板：只改字体/字号/行距，不伪造期刊官方模板 */
  template?: SubmissionTemplateStyle | string;
  figures?: ManuscriptFigure[];
}

/** Markdown 纯文本化（docx 段落用）：去 #、**、链接、列表符；表格转成可读行而非删掉竖线 */
export function mdToPlain(md: string): string {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    // 表格分隔行（|---|---|）整行丢弃；数据行把单元格用「 / 」连接。
    // 历史实现用 /[|>]+/ 全局删竖线：表格单元格被粘成一串，正文里的 | 也会被误删。
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_m, cells: string) => cells.split('|').map((c) => c.trim()).filter(Boolean).join(' / '))
    .replace(/^\s*>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 从 PNG IHDR 读宽高；读不到时回退 4:3，避免 DOCX 图片比例错乱。 */
function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  return { width: 800, height: 600 };
}

/** 投稿/交稿用 DOCX：标题 + 大纲 + 正文 + 图表 + 按 citation 顺序排列的参考文献。 */
export async function buildManuscriptDocx(input: ManuscriptDocxInput): Promise<{ buffer: Buffer; filename: string; template: SubmissionTemplateStyle }> {
  const template = typeof input.template === 'string' || input.template == null
    ? parseSubmissionTemplate(input.template)
    : input.template;
  const font = { font: template.font, size: template.bodySize };
  const para = (text: string, opts: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; bullet?: { level: number }; before?: number; after?: number } = {}) =>
    new Paragraph({
      text,
      heading: opts.heading,
      alignment: opts.alignment,
      bullet: opts.bullet,
      spacing: { line: template.lineSpacing, before: opts.before, after: opts.after },
      run: font,
    });

  const children: Paragraph[] = [
    para(input.title || '未命名论文', { heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    para(`导出时间：${new Date().toLocaleString('zh-CN')} · SciFlow 全自动 AI 科研助手 · 模板：${template.label}`, { alignment: AlignmentType.CENTER }),
    para('', { after: 120 }),
  ];

  if (input.outline.sections?.length) {
    children.push(para('大纲', { heading: HeadingLevel.HEADING_1 }));
    input.outline.sections.forEach((s) => {
      children.push(para(s.title, { bullet: { level: 0 } }));
      (s.subsections || []).forEach((sub) => children.push(para(sub, { bullet: { level: 1 } })));
    });
    children.push(para('', { after: 120 }));
  }

  children.push(para('正文', { heading: HeadingLevel.HEADING_1 }));
  const content = input.content || '（正文为空）';
  const rawParagraphs = content.split('\n');
  // 正文按段落转 docx 段落：先识别标题层级，再对非标题行剥离 markdown 语法
  for (const raw of rawParagraphs) {
    const line = raw.trim();
    if (!line) continue;
    if (/^##\s/.test(line)) {
      children.push(para(line.replace(/^##\s+/, ''), { heading: HeadingLevel.HEADING_2, before: 160 }));
    } else if (/^###\s/.test(line)) {
      children.push(para(line.replace(/^###\s+/, ''), { heading: HeadingLevel.HEADING_3, before: 120 }));
    } else {
      children.push(para(mdToPlain(line), { after: 100 }));
    }
  }

  if (input.figures?.length) {
    children.push(para('', { after: 120 }));
    children.push(para('图表', { heading: HeadingLevel.HEADING_1 }));
    input.figures.forEach((fig, i) => {
      const size = pngSize(fig.data);
      const maxWidth = 600;
      const width = Math.min(maxWidth, size.width);
      const height = Math.max(1, Math.round((size.height / size.width) * width));
      children.push(new Paragraph({
        children: [new ImageRun({ type: 'png', data: fig.data, transformation: { width, height } })],
        alignment: AlignmentType.CENTER,
        spacing: { line: template.lineSpacing, before: 120, after: 60 },
      }));
      children.push(para(`图 ${i + 1}${fig.caption ? `：${fig.caption}` : ''}`, { alignment: AlignmentType.CENTER, after: 160 }));
    });
  }

  if (input.refs.length) {
    children.push(para('', { after: 120 }));
    children.push(para('参考文献', { heading: HeadingLevel.HEADING_1 }));
    input.refs.forEach((r, i) => {
      const authors = parseAuthors(r.authors).join(', ');
      const line = `${i + 1}. ${r.title}${authors ? ` — ${authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}${r.doi ? `, DOI: ${r.doi}` : ''}`;
      children.push(para(line, { after: 80 }));
    });
  }

  const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  return {
    buffer,
    filename: `${input.title.replace(/[\\/:*?"<>|]/g, '_') || '未命名论文'}.docx`,
    template,
  };
}

/** Nature 等英文模板在标题里写了模板名；默认 generic 仍使用中文宋体。 */
export const DEFAULT_MANUSCRIPT_TEMPLATE = DEFAULT_SUBMISSION_TEMPLATE;
