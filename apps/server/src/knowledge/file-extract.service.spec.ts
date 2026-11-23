import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { FileExtractService, cleanExtractedText, detectExtractKind } from './file-extract.service';
import type { AiService } from '../ai/ai.service';

const service = new FileExtractService({} as AiService);

describe('detectExtractKind', () => {
  it('按扩展名与 mime 分流', () => {
    expect(detectExtractKind('a.pdf')).toBe('pdf');
    expect(detectExtractKind('a.docx')).toBe('docx');
    expect(detectExtractKind('a.xlsx')).toBe('xlsx');
    expect(detectExtractKind('a.pptx')).toBe('pptx');
    expect(detectExtractKind('a.epub')).toBe('epub');
    expect(detectExtractKind('a', 'image/png')).toBe('image');
    expect(detectExtractKind('a.mp4')).toBe('video');
    expect(detectExtractKind('a.zip')).toBeNull();
  });
});

describe('cleanExtractedText', () => {
  it('去 NUL/控制字符并保留结构', () => {
    const out = cleanExtractedText('标题\u0000\n\n\n\n正文\u0007');
    expect(out.text).toBe('标题\n\n\n正文');
    expect(out.truncated).toBe(false);
  });
  it('超长截断并标记', () => {
    const out = cleanExtractedText('字'.repeat(100), 20);
    expect(out.text).toContain('已截断');
    expect(out.truncated).toBe(true);
  });
});

describe('FileExtractService', () => {
  it('解析 DOCX 正文与表格', { timeout: 30000 }, async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun('研究问题与假设')] }),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph('变量')] }), new TableCell({ children: [new Paragraph('测量')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('满意度')] }), new TableCell({ children: [new Paragraph('五点量表')] })] }),
            ],
          }),
        ],
      }],
    });
    const buffer = await Packer.toBuffer(doc);
    const result = await service.extract({ name: 'plan.docx', data: Buffer.from(buffer) });
    expect(result.text).toContain('研究问题与假设');
    expect(result.text).toContain('满意度');
    expect(result.kind).toBe('docx');
    expect(['officeparser', 'mammoth']).toContain(result.parser);
  });

  it('解析 XLSX 多 sheet 与行列', async () => {
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet('样本');
    s1.addRow(['编号', '得分']);
    s1.addRow([1, 88]);
    const s2 = wb.addWorksheet('说明');
    s2.addRow(['指标', '定义']);
    s2.addRow(['有效样本', '剔除缺失后']);
    const buffer = await wb.xlsx.writeBuffer();
    const result = await service.extract({ name: 'data.xlsx', data: Buffer.from(buffer) });
    expect(result.text).toContain('【工作表：样本】');
    expect(result.text).toContain('【工作表：说明】');
    expect(result.text).toContain('编号');
    expect(result.text).toContain('有效样本');
    expect(result.parser).toBe('exceljs');
  });

  it('解析 PPTX 幻灯片文本', async () => {
    const pptx = new PptxGenJS();
    const slide = pptx.addSlide();
    slide.addText('研究设计与样本', { x: 1, y: 1, w: 8, h: 1 });
    slide.addText('2026 年秋季', { x: 1, y: 2.5, w: 8, h: 1 });
    const out = await pptx.write({ outputType: 'nodebuffer' });
    const result = await service.extract({ name: 'deck.pptx', data: Buffer.from(out as ArrayBuffer) });
    expect(result.text).toContain('研究设计与样本');
    expect(result.text).toContain('2026 年秋季');
  });

  it('解析 EPUB 章节', async () => {
    const epub = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
      'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试书</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>zh</dc:language></metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`),
      'OEBPS/c1.xhtml': strToU8('<html><body><h1>第一章</h1><p>研究背景与问题。</p></body></html>'),
    });
    const result = await service.extract({ name: 'book.epub', data: Buffer.from(epub) });
    expect(result.text).toContain('第一章');
    expect(result.text).toContain('研究背景与问题');
    expect(result.parser).toBe('epub2');
  });

  it('知识库内联 text 上传不依赖扩展名', async () => {
    const result = await service.extractKnowledgeUpload(
      'GNN 测试文献', 'text', '图神经网络通过消息传递聚合邻居特征。',
    );
    expect(result.kind).toBe('text');
    expect(result.text).toContain('消息传递');
  });

  it('知识库 text 上传即使文件名带 .pdf 也按纯文本处理', async () => {
    const result = await service.extractKnowledgeUpload(
      'Attention Is All You Need Deep Read.pdf', 'text', 'Transformer 的自注意力机制。',
    );
    expect(result.kind).toBe('text');
    expect(result.text).toContain('自注意力');
  });

  it('不支持格式与损坏文件返回可读错误', async () => {
    await expect(service.extract({ name: 'a.zip', data: Buffer.from('x') })).rejects.toThrow('不支持的格式');
    await expect(service.extract({ name: 'broken.docx', data: Buffer.from('not a zip') })).rejects.toThrow('解析失败');
  });

  it.runIf(process.env.RUN_OCR === '1')('扫描中文 PDF/图片 OCR 出中文', { timeout: 180_000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sciflow-ocr-test-'));
    try {
      const image = path.join(dir, 'scan.png');
      execFileSync('convert', [
        '-size', '900x260', 'xc:white', '-font', 'Noto-Sans-CJK-SC', '-pointsize', '64',
        '-gravity', 'center', '-annotate', '0', '科研数据 2026', image,
      ]);
      const imageResult = await service.extract({ name: 'scan.png', data: readFileSync(image) });
      expect(imageResult.text).toContain('科研');
      expect(imageResult.parser).toBe('tesseract');
      const pdf = path.join(dir, 'scan.pdf');
      // 用 reportlab 把同一张位图铺满 PDF 页面：没有文本层，才是真正的扫描件。
      // ImageMagick 发行版默认禁止写 PDF，不能拿 convert 生成测试样本。
      execFileSync('python3', ['-c', `
import sys
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
img, out = sys.argv[1], sys.argv[2]
w, h = 900, 260
c = canvas.Canvas(out, pagesize=(w, h))
c.drawImage(ImageReader(img), 0, 0, width=w, height=h)
c.save()
`, image, pdf]);
      const pdfResult = await service.extract({ name: 'scan.pdf', data: readFileSync(pdf) });
      expect(pdfResult.text).toContain('科研');
      expect(pdfResult.parser).toContain('tesseract');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('视频抽音轨后走转写回调', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sciflow-video-test-'));
    try {
      const video = path.join(dir, 'clip.mp4');
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=320x180:d=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-shortest', '-c:v', 'mpeg4', '-c:a', 'libmp3lame', video,
      ], { stdio: 'ignore' });
      const result = await service.extract(
        { name: 'clip.mp4', data: readFileSync(video) },
        { transcribe: async (_b, name) => `视频转写：${name}` },
      );
      expect(result.kind).toBe('video');
      expect(result.text).toContain('视频转写');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('音频走转写回调', async () => {
    const result = await service.extract(
      { name: 'meeting.mp3', mime: 'audio/mpeg', data: Buffer.from('fake-audio') },
      { transcribe: async (_b, name) => `转写：${name}` },
    );
    expect(result.text).toContain('转写：meeting.mp3');
    expect(result.kind).toBe('audio');
  });
});
