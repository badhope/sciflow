/**
 * 大工具输出暂存：模型只看到有界预览，完整内容落到进程临时目录，按 outputId 分页回读。
 *
 * 这是 Agent harness 的上下文保险丝：单个工具返回几万字论文/JSON 时，不把整段塞回模型；
 * 需要细节时由模型显式调用 read_tool_output，避免一次检索把上下文窗口吃穿。
 */
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUTPUT_DIR = () => process.env.SCIFLOW_TOOL_OUTPUT_DIR || join(tmpdir(), 'sciflow-tool-output');
const OUTPUT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_READ_CHARS = 20_000;
const MAX_STORE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FILES = 300;

export interface SpilledToolOutput {
  truncated: true;
  outputId: string;
  originalChars: number;
  preview: string;
  notice: string;
}

export interface ToolOutputPage {
  outputId: string;
  offset: number;
  limit: number;
  totalChars: number;
  text: string;
  nextOffset: number;
  eof: boolean;
}

function ensureDir(): string {
  const dir = OUTPUT_DIR();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** 删除过期/超量缓存；失败不影响主流程。 */
function prune(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const now = Date.now();
    for (const [i, file] of files.entries()) {
      if (i >= MAX_FILES || now - file.mtime > MAX_STORE_AGE_MS) {
        try {
          unlinkSync(file.path);
        } catch {
          /* 另一个请求可能已清掉 */
        }
      }
    }
  } catch {
    /* 缓存清理尽力而为 */
  }
}

/**
 * 超过 maxChars 时保留头 70% + 尾 30%：开头通常有结构，结尾常有错误/总结，
 * 只截头会丢掉模型最需要看的失败原因。
 */
export function previewToolText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.max(0, maxChars - head);
  const omitted = text.length - maxChars;
  return {
    text: `${text.slice(0, head)}\n…[中间省略 ${omitted} 字]…\n${text.slice(-tail)}`,
    truncated: true,
  };
}

export function spillToolText(text: string, maxChars: number): SpilledToolOutput | null {
  if (text.length <= maxChars) return null;
  const dir = ensureDir();
  prune(dir);
  const outputId = randomUUID();
  writeFileSync(join(dir, `${outputId}.txt`), text, { encoding: 'utf8', mode: 0o600 });
  const preview = previewToolText(text, maxChars).text;
  return {
    truncated: true,
    outputId,
    originalChars: text.length,
    preview,
    notice: `工具输出共 ${text.length} 字，已截断为预览。需要细节时调用 read_tool_output({ outputId, offset, limit })，不要猜测省略部分。`,
  };
}

export function readSpilledToolOutput(outputId: string, offset = 0, limit = 8_000): ToolOutputPage | { error: string } {
  if (!OUTPUT_ID_RE.test(outputId)) return { error: 'outputId 格式不合法。' };
  let text: string;
  try {
    text = readFileSync(join(ensureDir(), `${outputId}.txt`), 'utf8');
  } catch {
    return { error: '该工具输出已过期或不存在；请重新执行原工具，或基于当前预览回答。' };
  }
  const totalChars = text.length;
  const safeOffset = Math.max(0, Math.min(Math.floor(offset) || 0, totalChars));
  const safeLimit = Math.max(1, Math.min(Math.floor(limit) || 8_000, MAX_READ_CHARS));
  const end = Math.min(totalChars, safeOffset + safeLimit);
  return {
    outputId,
    offset: safeOffset,
    limit: safeLimit,
    totalChars,
    text: text.slice(safeOffset, end),
    nextOffset: end,
    eof: end >= totalChars,
  };
}

/** 工具结果归一化为可读文本：优先取 MCP content.text，避免 JSON 转义把字数翻倍。 */
export function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const content = (result as { content?: { text?: unknown }[] }).content;
    if (Array.isArray(content)) {
      const joined = content.map((c) => String(c?.text ?? '')).join('\n');
      if (joined) return joined;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  return String(result ?? '');
}
