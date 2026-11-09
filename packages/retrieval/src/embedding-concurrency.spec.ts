import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDING_DIM } from './embedding-config';
import { EmbeddingService } from './embedding.service';

/**
 * 本地嵌入并发闸门回归。
 *
 * 缺陷一（可配性）：`maxInflight` 写死为 4，而本项目所有其它并发/限流旋钮都走
 * `envInt(...)`（`AI_DRAFT_CONCURRENCY`、`AI_RPM_CAP`）。本地推理是 CPU 密集型，
 * 4 路在 2 核容器里会互相抢线程反而更慢，用户却没有任何办法调低——只能改源码。
 *
 * 缺陷二（实现）：闸门是手写的 5ms 忙轮询信号量
 * `while (this.inflight >= this.maxInflight) await setTimeout(5)`。
 * 一次 500 块的批量上传会瞬间创建 500 个 async 闭包，其中 496 个各自每 5ms 空转一次
 * （约 10 万次定时器回调），既浪费 CPU 又没有 FIFO 公平性（唤醒顺序由定时器注册顺序决定，
 * 靠后的块可能被反复插队）。项目在 ai-transport 里已经确立了
 * 「p-limit（成熟库替代手写实现）」的约定，这里是漏改的一处。
 */

const ENV_KEYS = ['EMBEDDING_MODEL_PATH', 'EMBEDDING_PROVIDER', 'EMBEDDING_CONCURRENCY'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // hasLocalModel() 只看文件是否存在，因此放一个假 GGUF 就能让后端判定走到 'local'；
  // 真正的推理上下文由下面注入的假 ctx 顶替，不会去加载 node-llama-cpp。
  const dir = mkdtempSync(join(tmpdir(), 'sciflow-emb-spec-'));
  const fake = join(dir, 'fake-model.gguf');
  writeFileSync(fake, 'not-a-real-gguf');
  process.env.EMBEDDING_MODEL_PATH = fake;
  process.env.EMBEDDING_PROVIDER = 'local';
});

afterEach(() => delete process.env.EMBEDDING_CONCURRENCY);

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

/** 构造「本地后端已就绪」的服务实例，用可控延迟的假上下文观测真实并发度 */
function makeService(delayMs = 8) {
  const svc = new EmbeddingService();
  let active = 0;
  let peak = 0;
  let calls = 0;
  (svc as unknown as { local: unknown }).local = {
    ctx: {
      getEmbeddingFor: async (_text: string) => {
        calls += 1;
        active += 1;
        if (active > peak) peak = active;
        await new Promise((r) => setTimeout(r, delayMs));
        active -= 1;
        return { vector: new Array<number>(EMBEDDING_DIM).fill(0.1) };
      },
    },
  };
  svc.onModuleInit();
  expect(svc.status().backend).toBe('local');
  return { svc, peak: () => peak, calls: () => calls };
}

const texts = (n: number) => Array.from({ length: n }, (_, i) => `第 ${i} 段待嵌入文本`);

describe('本地嵌入并发闸门：EMBEDDING_CONCURRENCY 可配', () => {
  it('显式设为 2 时，真实并发峰值就是 2', async () => {
    process.env.EMBEDDING_CONCURRENCY = '2';
    const s = makeService();
    const out = await s.svc.embedBatch(texts(8));
    expect(out.filter(Boolean)).toHaveLength(8);
    expect(s.peak()).toBe(2);
  });

  it('显式设为 1 时严格串行', async () => {
    process.env.EMBEDDING_CONCURRENCY = '1';
    const s = makeService();
    await s.svc.embedBatch(texts(5));
    expect(s.peak()).toBe(1);
    expect(s.calls()).toBe(5);
  });

  it('未配置时沿用默认 4', async () => {
    const s = makeService();
    await s.svc.embedBatch(texts(12));
    expect(s.peak()).toBe(4);
  });

  it('非法值回落默认，不产生 NaN 闸门（NaN 会让限流彻底失效）', async () => {
    process.env.EMBEDDING_CONCURRENCY = 'abc';
    const s = makeService();
    await s.svc.embedBatch(texts(10));
    expect(s.peak()).toBe(4);
  });

  it('越界值被夹取：0 → 1（不会死锁），999 → 上限 32', async () => {
    process.env.EMBEDDING_CONCURRENCY = '0';
    const s0 = makeService();
    const out0 = await s0.svc.embedBatch(texts(4));
    expect(out0.filter(Boolean)).toHaveLength(4);
    expect(s0.peak()).toBe(1);

    process.env.EMBEDDING_CONCURRENCY = '999';
    const s1 = makeService();
    await s1.svc.embedBatch(texts(40));
    expect(s1.peak()).toBeLessThanOrEqual(32);
  });
});

describe('本地嵌入并发闸门：批量语义', () => {
  it('返回值与输入等长且按位对应，失败位置为 null', async () => {
    process.env.EMBEDDING_CONCURRENCY = '3';
    const s = makeService();
    const out = await s.svc.embedBatch(texts(11));
    expect(out).toHaveLength(11);
    expect(out.every((b) => Buffer.isBuffer(b))).toBe(true);
    // 384 维 float32 → 1536 字节
    expect(out[0]!.byteLength).toBe(EMBEDDING_DIM * 4);
  });

  it('单条推理抛错只让该位置降级为 null，不拖垮整批', async () => {
    process.env.EMBEDDING_CONCURRENCY = '2';
    const svc = new EmbeddingService();
    let n = 0;
    (svc as unknown as { local: unknown }).local = {
      ctx: {
        getEmbeddingFor: async () => {
          n += 1;
          if (n === 2) throw new Error('boom');
          return { vector: new Array<number>(EMBEDDING_DIM).fill(0.2) };
        },
      },
    };
    svc.onModuleInit();
    const out = await svc.embedBatch(texts(4));
    expect(out).toHaveLength(4);
    expect(out.filter((b) => b === null)).toHaveLength(1);
    expect(out.filter((b) => Buffer.isBuffer(b))).toHaveLength(3);
  });

  it('空输入直接返回空数组，不触碰后端', async () => {
    const s = makeService();
    await expect(s.svc.embedBatch([])).resolves.toEqual([]);
    expect(s.calls()).toBe(0);
  });

  it('大批量不丢块：200 块在 cap=3 下全部产出（无饥饿/死锁）', async () => {
    process.env.EMBEDDING_CONCURRENCY = '3';
    const s = makeService(0);
    const out = await s.svc.embedBatch(texts(200));
    expect(out.filter(Boolean)).toHaveLength(200);
    expect(s.calls()).toBe(200);
  }, 30_000);
});
