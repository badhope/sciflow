import { Injectable, OnModuleInit, Logger, Optional, Inject } from '@nestjs/common';
import { EMBEDDING_DIM, hasLocalModel, localModelPath, resolveEmbeddingBackend, toVectorBlob, type EmbeddingBackend } from './embedding-config';

/**
 * 嵌入服务（本地 GGUF / 远程 OpenAI 兼容 /embeddings 双后端）
 * ============================================================================
 * 为 sqlite-vec 向量 ANN 检索提供语义嵌入能力。
 *
 * 后端选择（EMBEDDING_PROVIDER）：
 *  - `local`  仅用 node-llama-cpp 加载用户自备 GGUF（零内置模型，不自动下载）
 *  - `api`    用已配置的模型厂商的 `/embeddings` 端点（无需本地模型文件）
 *  - `auto`（默认）有 GGUF 文件走 local，否则 AI 已配置走 api，都不行则降级全文检索
 *
 * 为什么必须双后端：原实现只有本地 GGUF，且调用了 **不存在的 API**
 * （`LlamaContext.getEmbeddingFor`，而 node-llama-cpp 3.x 只在
 * `LlamaEmbeddingContext` 上提供该方法），导致 embed() 恒返回 null，
 * 向量索引从未生成过——「混合检索」实际只有 FTS5 单路。
 *
 * 维度契约：sqlite-vec 表固定 `FLOAT[384]`。任何后端产出的向量都必须等于该维度，
 * 否则写入会抛错并把整个上传事务回滚（用户看到 500）。这里统一在入口守卫：
 * 维度不符返回 null（该块降级为纯全文检索），并在日志里给出可操作提示。
 *
 * 纯逻辑（后端判定 / 路径 / 维度守卫）在 embedding-config.ts，本文件只负责 I/O 与并发。
 * ============================================================================
 */

export { EMBEDDING_DIM, localModelPath, resolveEmbeddingBackend, toVectorBlob };
export type { EmbeddingBackend };

/** 供 AiService 注入的最小接口（避免 retrieval 包直接继承 ai 包实现细节） */
export interface RemoteEmbedder {
  embedTexts(texts: string[], opts?: { model?: string }): Promise<number[][] | null>;
  readonly configured: boolean;
}

/** DI 令牌：接口在运行期被擦除，必须显式字符串令牌绑定（AiService 在 KnowledgeModule 里 useExisting） */
export const REMOTE_EMBEDDER = 'SCIFLOW_REMOTE_EMBEDDER';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  /** 本地 llama embedding 上下文；加载失败后不再重试，避免每次请求都卡一次 */
  private local: { ctx: { getEmbeddingFor: (t: string) => Promise<{ vector: readonly number[] }> } } | null = null;
  private localLoad: Promise<void> | null = null;
  private localFailed = false;
  private backend: EmbeddingBackend = 'none';
  /** 并发闸门：本地推理是 CPU 密集型，限制并发反而更快（避免线程争抢抖动） */
  private inflight = 0;
  private readonly maxInflight = 4;

  constructor(@Optional() @Inject(REMOTE_EMBEDDER) private readonly remote?: RemoteEmbedder) {}

  onModuleInit() {
    this.backend = this.pickBackend();
    const desc =
      this.backend === 'local'
        ? `本地 GGUF（${this.modelPath}）`
        : this.backend === 'api'
          ? '远程 /embeddings（沿用当前模型厂商的 baseURL 与 Key）'
          : '不可用（将只用全文检索 FTS5，不影响其他功能）';
    this.logger.log(`嵌入后端：${desc}`);
  }

  private get modelPath(): string {
    return localModelPath();
  }

  private pickBackend(): EmbeddingBackend {
    return resolveEmbeddingBackend({
      provider: process.env.EMBEDDING_PROVIDER,
      hasLocalModel: hasLocalModel(),
      aiConfigured: Boolean(this.remote?.configured),
      mockMode: process.env.AI_MOCK === '1',
    });
  }

  /** 当前生效后端与维度（健康探针/设置页展示用，不触发加载） */
  status(): { backend: EmbeddingBackend; dimension: number; modelPath: string } {
    return { backend: this.backend, dimension: EMBEDDING_DIM, modelPath: this.modelPath };
  }

  /** 懒加载本地模型（幂等、并发安全；失败只尝试一次） */
  private async loadLocal(): Promise<void> {
    if (this.local || this.localFailed) return;
    if (this.localLoad) return this.localLoad;
    this.localLoad = (async () => {
      try {
        if (!hasLocalModel()) {
          this.localFailed = true;
          return;
        }
        const { getLlama } = await import('node-llama-cpp');
        const llama = await getLlama();
        const model = await llama.loadModel({ modelPath: this.modelPath });
        // 关键修复：3.x 的 embedding 能力在 LlamaEmbeddingContext 上，不在 LlamaContext 上。
        const ctx = await model.createEmbeddingContext({ contextSize: 512 });
        const dim = Number(model.embeddingVectorSize) || 0;
        if (dim && dim !== EMBEDDING_DIM) {
          // 维度不符：写入 vec0 必然失败。直接判定不可用，走全文检索，而不是每次上传都 500。
          this.localFailed = true;
          this.logger.warn(
            `本地嵌入模型维度 ${dim} ≠ vec0 表维度 ${EMBEDDING_DIM}（${this.modelPath}）。` +
              `请换用 384 维模型（推荐 bge-small-zh-v1.5）或设置 EMBEDDING_PROVIDER=api；向量检索本次禁用，全文检索不受影响。`,
          );
          return;
        }
        this.local = {
          ctx: ctx as unknown as { getEmbeddingFor: (t: string) => Promise<{ vector: readonly number[] }> },
        };
        this.logger.log(`本地嵌入模型已加载（${dim || '未知'} 维），后续调用无冷启动开销`);
      } catch (e: unknown) {
        this.localFailed = true;
        this.logger.warn(`本地嵌入模型加载失败（降级全文检索）: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return this.localLoad;
  }

  /** 单条嵌入：返回 384 维 BLOB；任一后端不可用/维度不符返回 null */
  async embed(text: string): Promise<Buffer | null> {
    const [one] = await this.embedBatch([text]);
    return one ?? null;
  }

  /**
   * 批量嵌入（批量上传时的主路径）。
   * - API 后端：一次请求多值（上限 64/批），比逐条往返快一个数量级
   * - 本地后端：受限并发（默认 4），避免 N 个 chunk 同时抢 CPU 线程
   * 返回值与输入等长；失败位置为 null。
   */
  async embedBatch(texts: string[]): Promise<(Buffer | null)[]> {
    const input = (texts || []).map((t) => String(t ?? ''));
    if (input.length === 0) return [];
    // 后端可能在运行期变化（用户新放模型 / 新配置 Key）；每次先刷新判定，成本只有一次 existsSync
    this.backend = this.pickBackend();

    if (this.backend === 'api' && this.remote) {
      const out: (Buffer | null)[] = new Array(input.length).fill(null);
      const BATCH = 64;
      for (let i = 0; i < input.length; i += BATCH) {
        const slice = input.slice(i, i + BATCH);
        try {
          const vectors = await this.remote.embedTexts(slice);
          if (!vectors) return out;
          vectors.forEach((v, k) => {
            out[i + k] = toVectorBlob(v);
          });
        } catch (e: unknown) {
          this.logger.warn(`远程嵌入失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return out;
    }

    if (this.backend === 'local') {
      await this.loadLocal();
      if (!this.local) return new Array(input.length).fill(null);
      const out: (Buffer | null)[] = new Array(input.length).fill(null);
      // 信号量式并发：全局最多 maxInflight 个同时推理（跨请求共享计数）
      const acquire = async (): Promise<void> => {
        while (this.inflight >= this.maxInflight) await new Promise((r) => setTimeout(r, 5));
        this.inflight += 1;
      };
      await Promise.all(
        input.map(async (text, idx) => {
          await acquire();
          try {
            const emb = await this.local!.ctx.getEmbeddingFor(text);
            out[idx] = toVectorBlob(emb?.vector);
          } catch {
            out[idx] = null;
          } finally {
            this.inflight -= 1;
          }
        }),
      );
      return out;
    }

    return new Array(input.length).fill(null);
  }
}
