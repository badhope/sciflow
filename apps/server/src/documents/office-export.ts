import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';
import type { ManuscriptOutline, ManuscriptReference } from './manuscript-docx';

interface OfficeExportInput {
  title: string;
  outline: ManuscriptOutline;
  content: string;
  refs: ManuscriptReference[];
}

interface SectionBlock {
  title: string;
  body: string;
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

/** 按 Markdown 一级/二级标题切块；没有标题时整篇作为正文。 */
function splitSections(content: string): SectionBlock[] {
  const lines = content.split(/\r?\n/);
  const sections: SectionBlock[] = [];
  let title = '正文';
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) sections.push({ title, body });
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^#{1,2}\s+(.+)$/);
    if (m) {
      flush();
      title = cleanMarkdown(m[1]);
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ title: '正文', body: content.trim() }];
}

function safeName(title: string, ext: string): string {
  return `${(title || '未命名论文').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
}

export async function buildManuscriptPptx(input: OfficeExportInput): Promise<{ buffer: Buffer; filename: string }> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'SciFlow';
  pptx.subject = input.title;
  pptx.title = input.title;

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: 'F3FAF8' };
  titleSlide.addText(input.title || '未命名论文', { x: 0.8, y: 1.8, w: 11.8, h: 1.4, fontSize: 30, bold: true, color: '0B3B39', breakLine: false });
  titleSlide.addText('SciFlow · 论文演示稿', { x: 0.8, y: 3.3, w: 7, h: 0.5, fontSize: 14, color: '39726C' });
  titleSlide.addText(new Date().toLocaleDateString('zh-CN'), { x: 0.8, y: 3.8, w: 4, h: 0.4, fontSize: 11, color: '7A9C96' });

  const outlineSlide = pptx.addSlide();
  outlineSlide.addText('大纲', { x: 0.7, y: 0.5, w: 4, h: 0.6, fontSize: 24, bold: true, color: '0B3B39' });
  const outlineLines = input.outline.sections?.length
    ? input.outline.sections.map((s, i) => `${i + 1}. ${s.title}${s.subsections?.length ? `\n   ${s.subsections.join(' / ')}` : ''}`).join('\n')
    : '（未设置大纲）';
  outlineSlide.addText(outlineLines, { x: 0.8, y: 1.35, w: 11.5, h: 5.6, fontSize: 14, color: '334155', breakLine: false, valign: 'top' });

  const blocks = splitSections(input.content || '');
  for (const block of blocks) {
    // 每页最多约 900 字，超出按段落切页，避免 PPT 文本溢出。
    const paragraphs = block.body.split(/\n{2,}/).map((p) => cleanMarkdown(p)).filter(Boolean);
    let chunk: string[] = [];
    let chars = 0;
    const flush = () => {
      if (!chunk.length) return;
      const slide = pptx.addSlide();
      slide.addText(block.title, { x: 0.7, y: 0.45, w: 11.8, h: 0.55, fontSize: 20, bold: true, color: '0B3B39' });
      slide.addText(chunk.map((p) => `• ${p}`).join('\n\n'), { x: 0.8, y: 1.25, w: 11.6, h: 5.6, fontSize: 13, color: '334155', breakLine: false, valign: 'top' });
      chunk = [];
      chars = 0;
    };
    for (const p of paragraphs) {
      if (chars + p.length > 900 && chunk.length) flush();
      chunk.push(p.length > 900 ? `${p.slice(0, 900)}…` : p);
      chars += p.length;
    }
    flush();
  }

  if (input.refs.length) {
    const slide = pptx.addSlide();
    slide.addText('参考文献', { x: 0.7, y: 0.45, w: 8, h: 0.55, fontSize: 20, bold: true, color: '0B3B39' });
    const refs = input.refs.slice(0, 12).map((r, i) => `[${i + 1}] ${r.title}${r.authors ? ` — ${r.authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}`).join('\n');
    slide.addText(refs, { x: 0.8, y: 1.2, w: 11.5, h: 5.6, fontSize: 12, color: '475569', breakLine: false, valign: 'top' });
  }

  const data = await pptx.write({ outputType: 'nodebuffer' });
  return { buffer: Buffer.from(data as ArrayBuffer), filename: safeName(input.title, 'pptx') };
}

export function buildManuscriptXlsx(input: OfficeExportInput): { buffer: Buffer; filename: string } {
  const wb = XLSX.utils.book_new();
  const bodyRows: string[][] = [['章节', '小节', '内容']];
  const blocks = splitSections(input.content || '');
  for (const block of blocks) {
    for (const para of block.body.split(/\n{2,}/).map((p) => cleanMarkdown(p)).filter(Boolean)) {
      bodyRows.push([block.title, '', para]);
    }
  }
  if (bodyRows.length === 1) bodyRows.push(['正文', '', '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bodyRows), '正文');

  const outlineRows: string[][] = [['序号', '章节', '小节']];
  (input.outline.sections || []).forEach((s, i) => {
    if (s.subsections?.length) {
      for (const sub of s.subsections) outlineRows.push([String(i + 1), s.title, sub]);
    } else {
      outlineRows.push([String(i + 1), s.title, '']);
    }
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(outlineRows), '大纲');

  const refRows: (string | number | null)[][] = [['序号', '标题', '作者', '年份', '期刊/会议', 'DOI']];
  input.refs.forEach((r, i) => refRows.push([i + 1, r.title, r.authors || '', r.year ?? '', r.venue || '', r.doi || '']));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(refRows), '参考文献');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { buffer, filename: safeName(input.title, 'xlsx') };
}
