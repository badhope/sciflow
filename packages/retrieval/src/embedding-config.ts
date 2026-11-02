/**
 * 嵌入后端选择与向量转换（纯函数，零 NestJS 依赖）。
 *
 * 单独成文件的原因：
 *  1. 可在 vitest 里直接单测（embedding.service.ts 带参数装饰器，esbuild 默认不开启
 *     experimentalDecorators 时无法被测试直接 import）；
 *  2. 后端判定与「怎么调模型」解耦，未来换后端（例如 ONNX / transformers.js）只改 service。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** vec0 表维度（packages/db/src/database.ts 建表固定 FLOAT[384]） */
export const EMBEDDING_DIM = 384;

/** 推荐 GGUF：bge-small-zh-v1.5 q4_k_m（384 维，~50MB） */
const MODEL_NAME = 'bge-small-zh-v1.5-q4_k_m.gguf';

function cacheDir(): string {
  return path.resolve(
    process.env.SCIFLOW_MODEL_CACHE ||
      path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.sciflow', 'models'),
  );
}

/** 用户显式配置的 GGUF 路径；否则默认缓存目录下的推荐模型（不自动下载） */
export function localModelPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EMBEDDING_MODEL_PATH) return path.resolve(env.EMBEDDING_MODEL_PATH);
  return path.join(cacheDir(), MODEL_NAME);
}

/** 本地模型文件是否存在（只看文件，不加载） */
export function hasLocalModel(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return fs.existsSync(localModelPath(env));
  } catch {
    return false;
  }
}

export type EmbeddingBackend = 'local' | 'api' | 'none';

/**
 * 后端解析纯函数（便于单测，不读模块级状态）。
 * 显式配置优先；auto 下按「有本地模型文件 → local，否则 AI 已配置 → api」。
 */
export function resolveEmbeddingBackend(opts: {
  provider?: string;
  hasLocalModel: boolean;
  aiConfigured: boolean;
  mockMode?: boolean;
}): EmbeddingBackend {
  const provider = String(opts.provider || 'auto').trim().toLowerCase();
  if (provider === 'local') return opts.hasLocalModel ? 'local' : 'none';
  if (provider === 'api') return opts.aiConfigured && !opts.mockMode ? 'api' : 'none';
  if (opts.hasLocalModel) return 'local';
  if (opts.aiConfigured && !opts.mockMode) return 'api';
  return 'none';
}

/** 向量 → sqlite-vec 需要的 BLOB；维度不符返回 null（调用方降级为纯全文检索） */
export function toVectorBlob(vec: readonly number[] | null | undefined, dim = EMBEDDING_DIM): Buffer | null {
  if (!vec || vec.length !== dim) return null;
  const f = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) f[i] = Number(vec[i]) || 0;
  return Buffer.from(f.buffer);
}
