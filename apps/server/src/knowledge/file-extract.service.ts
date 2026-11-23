import { BadRequestException, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AiService } from '../ai/ai.service';
import { DB_PATH } from '../db/database';

/** 对话附件保持 4 个 / 6MB；知识库单文件上限 30MB，均在原模块内校验。 */
export const MAX_KNOWLEDGE_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_MEDIA_SECONDS = 30 * 60;
export const MAX_OCR_PAGES = 20;
export const MAX_EXTRACT_CHARS = 300_000;

export type ExtractKind =
  | 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'epub' | 'image' | 'audio' | 'video';

export interface ExtractFileInput {
  name: string;
  mime?: string;
  data: Buffer;
}

export interface ExtractFileResult {
  text: string;
  kind: ExtractKind;
  /** 解析器名称，供 UI/日志展示 */
  parser: string;
  /** 是否因字符上限截断 */
  truncated: boolean;
  /** OCR/转写等附加提示 */
  notes: string[];
}

export interface ExtractOptions {
  /** 音频/视频转写回调；不传则音视频返回可读错误 */
  transcribe?: (buffer: Buffer, filename: string, mime: string) => Promise<string>;
  /** 知识库允许 30MB，对话附件由上层先做 6MB 限制 */
  maxBytes?: number;
  maxChars?: number;
  /** OCR 页数上限（扫描 PDF / 图片型 PPTX） */
  maxOcrPages?: number;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|tex|bib|ris|html|htm|log)$/i;
const TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|yaml|x-tex|bibtex|x-research-info-systems))/i;
const IMAGE_EXT = /\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|opus|flac|webm)$/i;
const VIDEO_EXT = /\.(mp4|mov|mkv|avi|m4v|wmv|flv|mpeg|mpg)$/i;

function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,12})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function detectExtractKind(name: string, mime = ''): ExtractKind | null {
  const ext = extOf(name);
  const lowerMime = mime.toLowerCase();
  if (ext === 'pdf' || lowerMime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc' || ext === 'odt' || ext === 'rtf') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') return 'xlsx';
  if (ext === 'pptx' || ext === 'ppt' || ext === 'odp') return 'pptx';
  if (ext === 'epub') return 'epub';
  if (IMAGE_EXT.test(name) || lowerMime.startsWith('image/')) return 'image';
  if (AUDIO_EXT.test(name) || lowerMime.startsWith('audio/')) return 'audio';
  if (VIDEO_EXT.test(name) || lowerMime.startsWith('video/')) return 'video';
  if (TEXT_EXT.test(name) || TEXT_MIME.test(lowerMime)) return 'text';
  return null;
}

/** 统一清洗：去 NUL/控制字符/不可见 Unicode，统一换行，压缩空白；不改变正文语义。 */
export function cleanExtractedText(raw: string, maxChars = MAX_EXTRACT_CHARS): { text: string; truncated: boolean } {
  const cleaned = String(raw || '')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false };
  return { text: `${cleaned.slice(0, maxChars)}\n\n…[正文超过 ${maxChars} 字符，已截断]`, truncated: true };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(cmd: string, args: string[], timeoutMs = 120_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} 超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

let ffmpegBinaryPromise: Promise<string> | null = null;
let ffprobeBinaryPromise: Promise<string> | null = null;

async function ffmpegBinary(): Promise<string> {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  if (!ffmpegBinaryPromise) {
    ffmpegBinaryPromise = import('ffmpeg-static').then((m) => {
      const p = String((m as unknown as { default?: string }).default || '');
      // 安装脚本被代理拦下时 ffmpeg-static 可能只剩包壳；系统 ffmpeg 是同一工具的可靠兜底。
      return p && existsSync(p) ? p : 'ffmpeg';
    }).catch(() => 'ffmpeg');
  }
  return ffmpegBinaryPromise;
}

async function ffprobeBinary(): Promise<string> {
  if (!ffprobeBinaryPromise) {
    ffprobeBinaryPromise = import('ffprobe-static').then((m) => {
      const p = String((m as unknown as { default?: { path?: string }; path?: string }).path
        || (m as unknown as { default?: { path?: string } }).default?.path || '');
      return p && existsSync(p) ? p : 'ffprobe';
    }).catch(() => 'ffprobe');
  }
  return ffprobeBinaryPromise;
}

async function probeMediaDuration(buffer: Buffer, name: string): Promise<number | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sciflow-media-'));
  const input = path.join(dir, name || 'media');
  try {
    await writeFile(input, buffer);
    const probe = await ffprobeBinary();
    const out = await runCommand(probe, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input,
    ], 30_000);
    if (out.code !== 0) return null;
    const seconds = Number(out.stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractVideoAudioTrack(buffer: Buffer, name: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sciflow-video-'));
  const input = path.join(dir, name || 'video');
  const output = path.join(dir, 'audio.mp3');
  try {
    await writeFile(input, buffer);
    const ffmpeg = await ffmpegBinary();
    const out = await runCommand(ffmpeg, [
      '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-t', String(MAX_MEDIA_SECONDS),
      '-f', 'mp3', output,
    ], 180_000);
    if (out.code !== 0) {
      throw new Error((out.stderr || '视频音轨抽取失败').slice(-500));
    }
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 懒加载 tesseract worker；语言包首次下载较慢，进程内复用。 */
let ocrWorkerPromise: Promise<any> | null = null;
async function ocrBuffer(buffer: Buffer): Promise<string> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import('tesseract.js').then(async ({ createWorker }) => {
      // 优先用系统 tessdata：离线/内网环境不能依赖首次运行时从 GitHub 下载语言包。
      // Docker 镜像安装 tesseract-ocr + chi_sim 后即命中；仍允许 TESSERACT_LANG_PATH 覆盖。
      const candidates = [
        process.env.TESSERACT_LANG_PATH,
        '/usr/share/tesseract-ocr/5/tessdata',
        '/usr/share/tesseract-ocr/4.00/tessdata',
        '/usr/share/tessdata',
      ].filter((p): p is string => Boolean(p));
      const langPath = candidates.find((p) => existsSync(path.join(p, 'chi_sim.traineddata')));
      // 无系统语言包时才落缓存目录（不污染仓库根，且不会每次重启重下）。
      const cachePath = process.env.TESSERACT_CACHE_PATH || path.join(path.dirname(DB_PATH), 'tesseract');
      const worker = await createWorker('chi_sim+eng', undefined, {
        cachePath,
        // 系统 tessdata 是未压缩的 .traineddata；tesseract.js 默认按 .gz 找会 ENOENT。
        ...(langPath ? { langPath, gzip: false } : {}),
      });
      return worker;
    });
  }
  const worker = await ocrWorkerPromise;
  const result = await worker.recognize(buffer);
  return String(result?.data?.text || '');
}

async function ocrPdf(buffer: Buffer, name: string, maxPages: number): Promise<{ text: string; pages: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sciflow-pdf-ocr-'));
  const input = path.join(dir, name || 'document.pdf');
  const prefix = path.join(dir, 'page');
  try {
    await writeFile(input, buffer);
    const out = await runCommand('pdftoppm', [
      '-f', '1', '-l', String(maxPages), '-r', '150', '-png', input, prefix,
    ], 120_000);
    if (out.code !== 0) {
      throw new Error((out.stderr || 'PDF 渲染失败（需要安装 poppler-utils）').slice(-400));
    }
    const files = (await readdir(dir)).filter((f) => /^page-\d+\.png$/i.test(f)).sort((a, b) => {
      const an = Number(a.match(/(\d+)/)?.[1] || 0);
      const bn = Number(b.match(/(\d+)/)?.[1] || 0);
      return an - bn;
    });
    const texts: string[] = [];
    for (const file of files) {
      const image = await readFile(path.join(dir, file));
      const text = await ocrBuffer(image);
      if (text.trim()) texts.push(`【第 ${texts.length + 1} 页】\n${text.trim()}`);
    }
    return { text: texts.join('\n\n'), pages: files.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractPdf(buffer: Buffer, name: string, maxOcrPages: number, notes: string[]): Promise<string> {
  const { extractText } = await import('unpdf');
  const parsed = await extractText(new Uint8Array(buffer), { mergePages: true });
  let text = String((parsed as { text?: string }).text || '').trim();
  if (text.replace(/\s/g, '').length >= 50) return text;
  try {
    const ocr = await ocrPdf(buffer, name, maxOcrPages);
    if (ocr.text.trim()) {
      notes.push(`扫描 PDF 已 OCR ${ocr.pages} 页（上限 ${maxOcrPages} 页）`);
      text = ocr.text;
    }
  } catch (e: unknown) {
    notes.push(`OCR 失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!text.trim()) throw new Error('PDF 没有可提取文本，OCR 也未识别出内容');
  return text;
}

async function extractDocx(buffer: Buffer, name: string, notes: string[]): Promise<string> {
  const office = await import('officeparser') as unknown as { parseOffice: (b: Buffer, cfg?: Record<string, unknown>) => Promise<any> };
  let text = '';
  try {
    const ast = await office.parseOffice(buffer, { fileType: extOf(name) === 'doc' ? 'doc' : extOf(name) || 'docx' });
    if (typeof ast?.to === 'function') {
      const out = await ast.to('text');
      text = typeof out === 'string' ? out : String(out?.value || out?.text || '');
    } else {
      text = String(ast || '');
    }
  } catch (e: unknown) {
    notes.push(`officeparser 解析失败，改用 mammoth：${e instanceof Error ? e.message : String(e)}`);
  }
  if (text.replace(/\s/g, '').length < 20) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    if (value.trim()) text = value;
  }
  if (!text.trim()) throw new Error('DOCX 没有可提取文本');
  return text;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.formula || obj.sharedFormula) return `=${String(obj.formula || obj.sharedFormula)}${obj.result !== undefined ? ` → ${String(obj.result)}` : ''}`;
    if (obj.text) return String(obj.text);
    if (obj.richText) return (obj.richText as { text?: string }[]).map((x) => x.text || '').join('');
    if (obj.hyperlink) return String(obj.text || obj.hyperlink);
    if (obj.error) return `#${String(obj.error)}`;
  }
  return String(value);
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const ExcelJS = await import('exceljs');
  const Workbook = (ExcelJS as unknown as { default?: typeof import('exceljs'); Workbook?: typeof import('exceljs').Workbook }).Workbook
    || (ExcelJS as unknown as { default: typeof import('exceljs') }).default.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const blocks: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines: string[] = [`【工作表：${sheet.name}】`];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(stringifyCell(cell.value).replace(/\t/g, ' '));
      });
      lines.push(`${rowNumber}\t${cells.join('\t')}`);
    });
    blocks.push(lines.join('\n'));
  });
  if (!blocks.length) throw new Error('XLSX 没有可读取的工作表');
  return blocks.join('\n\n');
}

async function officeAstText(buffer: Buffer, fileType: string): Promise<string> {
  const office = await import('officeparser') as unknown as { parseOffice: (b: Buffer, cfg?: Record<string, unknown>) => Promise<any> };
  const ast = await office.parseOffice(buffer, { fileType });
  if (typeof ast?.to === 'function') {
    const out = await ast.to('text');
    return typeof out === 'string' ? out : String(out?.value || out?.text || '');
  }
  return String(ast || '');
}

async function extractPptx(buffer: Buffer, name: string): Promise<string> {
  const text = await officeAstText(buffer, extOf(name) || 'pptx');
  if (!text.trim()) throw new Error('PPTX 没有可提取文本（图片型幻灯片请先 OCR）');
  return text;
}

async function extractEpub(buffer: Buffer, name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sciflow-epub-'));
  const input = path.join(dir, name || 'book.epub');
  try {
    await writeFile(input, buffer);
    const mod = await import('epub2') as unknown as { EPub?: any; default?: any };
    const EPub = mod.EPub || mod.default?.EPub || mod.default;
    const epub = new EPub(input);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('EPUB 解析超时')), 30_000);
      epub.on('end', () => { clearTimeout(timer); resolve(); });
      epub.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
      epub.parse();
    });
    const flow: { id: string }[] = Array.isArray(epub.flow) ? epub.flow : [];
    const chapters: string[] = [];
    for (const chapter of flow) {
      const raw = await new Promise<string>((resolve, reject) => {
        epub.getChapterRaw(chapter.id, (err: Error, text?: string) => (err ? reject(err) : resolve(String(text || ''))));
      });
      const text = htmlToText(raw).trim();
      if (text) chapters.push(`【章节 ${chapters.length + 1}】\n${text}`);
    }
    if (chapters.length) return chapters.join('\n\n');
    // epub2 对部分非标准 EPUB 只给空 flow：用 officeparser 兜底，仍不手写 XHTML 解析。
    const fallback = await officeAstText(buffer, 'epub');
    if (fallback.trim()) return fallback;
    throw new Error('EPUB 没有可提取章节');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

@Injectable()
export class FileExtractService {
  constructor(private readonly ai: AiService) {}

  async extract(input: ExtractFileInput, options: ExtractOptions = {}): Promise<ExtractFileResult> {
    const { name, mime = '', data } = input;
    if (!data?.length) throw new BadRequestException(`「${name || '附件'}」为空`);
    const maxBytes = options.maxBytes ?? MAX_KNOWLEDGE_FILE_BYTES;
    if (data.byteLength > maxBytes) {
      throw new BadRequestException(`「${name}」超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
    }
    const kind = detectExtractKind(name, mime);
    if (!kind) {
      throw new BadRequestException(`不支持的格式：${mime || extOf(name) || name}（支持 PDF/Office/EPUB/图片/音视频/文本）`);
    }
    const maxChars = options.maxChars ?? MAX_EXTRACT_CHARS;
    const maxOcrPages = Math.max(1, Math.min(options.maxOcrPages ?? MAX_OCR_PAGES, 50));
    const notes: string[] = [];
    let parser: string = kind;
    let raw = '';
    try {
      if (kind === 'text') {
        raw = data.toString('utf8');
        if (raw.includes('\u0000')) throw new BadRequestException(`「${name}」不是文本文件`);
        parser = 'text';
      } else if (kind === 'pdf') {
        raw = await extractPdf(data, name, maxOcrPages, notes);
        parser = notes.some((n) => n.includes('OCR')) ? 'unpdf+tesseract' : 'unpdf';
      } else if (kind === 'docx') {
        raw = await extractDocx(data, name, notes);
        parser = notes.some((n) => n.includes('mammoth')) ? 'mammoth' : 'officeparser';
      } else if (kind === 'xlsx') {
        raw = await extractXlsx(data);
        parser = 'exceljs';
      } else if (kind === 'pptx') {
        raw = await extractPptx(data, name);
        parser = 'officeparser';
      } else if (kind === 'epub') {
        raw = await extractEpub(data, name);
        parser = 'epub2';
      } else if (kind === 'image') {
        raw = await ocrBuffer(data);
        parser = 'tesseract';
        notes.push(`图片 OCR：${name}`);
      } else if (kind === 'audio' || kind === 'video') {
        if (!options.transcribe) throw new BadRequestException('未配置音频转写模型，无法解析音视频');
        const duration = await probeMediaDuration(data, name);
        if (duration && duration > MAX_MEDIA_SECONDS) {
          throw new BadRequestException(`「${name}」时长 ${Math.round(duration)} 秒，超过 ${MAX_MEDIA_SECONDS / 60} 分钟上限`);
        }
        const audio = kind === 'video' ? await extractVideoAudioTrack(data, name) : data;
        const audioMime = kind === 'video' ? 'audio/mpeg' : (mime || 'audio/mpeg');
        raw = await options.transcribe(audio, `${name.replace(/\.\w+$/, '')}.mp3`, audioMime);
        parser = kind === 'video' ? 'ffmpeg+transcription' : 'transcription';
        notes.push(kind === 'video' ? '已抽取音轨后转写' : '音频已转写');
      }
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      const message = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`「${name}」解析失败：${message}`);
    }
    const cleaned = cleanExtractedText(raw, maxChars);
    if (!cleaned.text) throw new BadRequestException(`「${name}」没有可提取文本`);
    return { text: cleaned.text, kind, parser, truncated: cleaned.truncated, notes };
  }

  /** 知识库上传便捷入口：type=text/markdown 直接当文本，其余按扩展名/base64 解析。 */
  async extractKnowledgeUpload(name: string, type: string, content: string): Promise<ExtractFileResult> {
    const kind = detectExtractKind(name, type);
    const isPlain = type === 'text' || type === 'markdown' || type === 'txt' || kind === 'text';
    const data = isPlain ? Buffer.from(content || '', 'utf8') : Buffer.from(content || '', 'base64');
    return this.extract(
      { name, mime: type === 'pdf' ? 'application/pdf' : type, data },
      { maxBytes: MAX_KNOWLEDGE_FILE_BYTES, maxChars: MAX_EXTRACT_CHARS },
    );
  }
}
