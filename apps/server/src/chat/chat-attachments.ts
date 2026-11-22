import { BadRequestException } from '@nestjs/common';
import type { ChatContentPart } from '../ai/ai.service';

/** 前端上传的附件：data 为 base64（不含 data:...;base64, 前缀） */
export interface ChatAttachmentInput {
  name: string;
  mime: string;
  data: string;
}

export interface PreparedChatTurn {
  /** 合并附件文本后的用户消息（纯文本，用于摘要/日志/上下文检索） */
  message: string;
  /** 多模态 parts；只有带图片时才返回 */
  parts?: ChatContentPart[];
  /** 附件摘要，供日志和前端展示 */
  summary: string[];
}

export const MAX_ATTACHMENT_FILES = 4;
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT_CHARS = 40_000;

const TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/xml',
  'text/xml',
  'application/x-yaml',
  'text/yaml',
]);

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function base64Bytes(data: string): Buffer {
  try {
    return Buffer.from(data, 'base64');
  } catch {
    throw new BadRequestException('附件 base64 解码失败');
  }
}

function textOf(name: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return `\n\n【附件：${name}】\n${trimmed}`;
}

async function extractPdf(data: Buffer, name: string): Promise<string> {
  try {
    // unpdf 2.x 只发 ESM，服务端产物是 CommonJS，和 knowledge.service 一样动态 import。
    const { extractText } = await import('unpdf');
    const parsed = await extractText(new Uint8Array(data), { mergePages: true });
    const text = String((parsed as { text?: string }).text || '').trim();
    if (!text) throw new Error('PDF 没有可提取文本（扫描件请先 OCR）');
    return text;
  } catch (e: any) {
    throw new BadRequestException(`附件「${name}」解析失败：${e?.message || String(e)}`);
  }
}

/**
 * 把当前轮附件整理成模型可消费的纯文本 + 图片 parts。
 * 历史轮不重复发送附件，避免每次对话把几 MB 图片重新上传。
 */
export async function prepareChatTurn(
  message: string,
  attachments: ChatAttachmentInput[] | undefined,
): Promise<PreparedChatTurn> {
  const list = (attachments || []).filter((a) => a && a.data);
  if (!list.length) return { message, summary: [] };
  if (list.length > MAX_ATTACHMENT_FILES) {
    throw new BadRequestException(`最多上传 ${MAX_ATTACHMENT_FILES} 个附件`);
  }

  const textBlocks: string[] = [];
  const imageParts: ChatContentPart[] = [];
  const summary: string[] = [];
  let textChars = 0;

  for (const attachment of list) {
    const bytes = base64Bytes(attachment.data);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(`附件「${attachment.name}」超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 上限`);
    }
    const mime = (attachment.mime || '').toLowerCase();
    const name = attachment.name || '未命名附件';

    if (mime.startsWith('image/')) {
      if (!IMAGE_MIMES.has(mime)) {
        throw new BadRequestException(`不支持的图片格式：${mime}（支持 PNG/JPEG/WebP/GIF）`);
      }
      imageParts.push({ type: 'image', image: `data:${mime};base64,${attachment.data}`, mediaType: mime });
      summary.push(`图片：${name}`);
      continue;
    }

    let text = '';
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
      text = await extractPdf(bytes, name);
      summary.push(`PDF：${name}（${text.length} 字）`);
    } else if (TEXT_MIMES.has(mime) || /\.(txt|md|csv|json|xml|yaml|yml)$/i.test(name)) {
      text = bytes.toString('utf8');
      if (text.includes('\u0000')) throw new BadRequestException(`附件「${name}」不是文本文件`);
      summary.push(`文本：${name}（${text.length} 字）`);
    } else {
      throw new BadRequestException(`不支持的附件类型：${mime || name}`);
    }

    if (textChars + text.length > MAX_ATTACHMENT_TEXT_CHARS) {
      const remain = Math.max(0, MAX_ATTACHMENT_TEXT_CHARS - textChars);
      text = text.slice(0, remain) + (remain < text.length ? '\n…[附件文本已截断]' : '');
    }
    textChars += text.length;
    const block = textOf(name, text);
    if (block) textBlocks.push(block);
  }

  const base = message.trim() || (imageParts.length ? '请分析我上传的图片。' : '请阅读我上传的附件。');
  const merged = `${base}${textBlocks.join('')}`;
  if (!imageParts.length) return { message: merged, summary };
  return {
    message: merged,
    parts: [{ type: 'text', text: merged }, ...imageParts],
    summary,
  };
}
