import { AlignmentType, Document, HeadingLevel, Packer, Paragraph } from 'docx';
import { parseAuthors } from '../common/authors';

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

export interface ManuscriptDocxInput {
  title: string;
  outline: ManuscriptOutline;
  content: string;
  refs: ManuscriptReference[];
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

/** 投稿/交稿用 DOCX：标题 + 大纲 + 正文 + 按 citation 顺序排列的参考文献。 */
export async function buildManuscriptDocx(input: ManuscriptDocxInput): Promise<{ buffer: Buffer; filename: string }> {
  const children: Paragraph[] = [
    new Paragraph({ text: input.title || '未命名论文', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: `导出时间：${new Date().toLocaleString('zh-CN')} · SciFlow 全自动 AI 科研助手`, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: '', spacing: { after: 120 } }),
  ];

  if (input.outline.sections?.length) {
    children.push(new Paragraph({ text: '大纲', heading: HeadingLevel.HEADING_1 }));
    input.outline.sections.forEach((s) => {
      children.push(new Paragraph({ text: s.title, bullet: { level: 0 } }));
      (s.subsections || []).forEach((sub) => children.push(new Paragraph({ text: sub, bullet: { level: 1 } })));
    });
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
  }

  children.push(new Paragraph({ text: '正文', heading: HeadingLevel.HEADING_1 }));
  const content = input.content || '（正文为空）';
  const rawParagraphs = content.split('\n');
  // 正文按段落转 docx 段落：先识别标题层级，再对非标题行剥离 markdown 语法
  for (const raw of rawParagraphs) {
    const line = raw.trim();
    if (!line) continue;
    if (/^##\s/.test(line)) {
      children.push(new Paragraph({ text: line.replace(/^##\s+/, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 160 } }));
    } else if (/^###\s/.test(line)) {
      children.push(new Paragraph({ text: line.replace(/^###\s+/, ''), heading: HeadingLevel.HEADING_3, spacing: { before: 120 } }));
    } else {
      children.push(new Paragraph({ text: mdToPlain(line), spacing: { after: 100 } }));
    }
  }

  if (input.refs.length) {
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    children.push(new Paragraph({ text: '参考文献', heading: HeadingLevel.HEADING_1 }));
    input.refs.forEach((r, i) => {
      const authors = parseAuthors(r.authors).join(', ');
      const line = `${i + 1}. ${r.title}${authors ? ` — ${authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}${r.doi ? `, DOI: ${r.doi}` : ''}`;
      children.push(new Paragraph({ text: line, spacing: { after: 80 } }));
    });
  }

  const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  return {
    buffer,
    filename: `${input.title.replace(/[\\/:*?"<>|]/g, '_') || '未命名论文'}.docx`,
  };
}
