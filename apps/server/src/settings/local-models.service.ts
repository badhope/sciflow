import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SettingsService } from './settings.service';
import { findLocalModel, LOCAL_MODELS, type LocalModelSpec } from './local-models.catalog';

const OLLAMA_BASE = 'http://127.0.0.1:11434';

type DownloadStatus = 'idle' | 'downloading' | 'verifying' | 'installed' | 'error' | 'cancelled';

interface DownloadState {
  id: string;
  status: DownloadStatus;
  received: number;
  total: number;
  speedBps: number;
  error?: string;
  startedAt: number;
  controller?: AbortController;
  hash?: string;
}

export interface LocalModelView extends LocalModelSpec {
  installed: boolean;
  downloadedBytes: number;
  status: DownloadStatus;
  error?: string;
  speedBps: number;
  filePath: string;
  /** 该模型是否已经作为 Ollama 模型导入并生成 provider */
  providerName?: string;
}

/**
 * 本地模型下载 / 校验 / 导入 Ollama 的一条龙服务。
 *
 * 设计取舍：
 *  - 不做「内置推理运行时」：桌面端已有 node-llama-cpp 仅用于 embedding，强行塞聊天
 *    server 会把安装包和内存占用推高，违背本产品的轻量定位；
 *  - 下载后优先调用本机 Ollama 的 `/api/create` 注册模型，再登记一个可选的
 *    OpenAI-compatible provider；是否启用由用户自己决定，不自动切默认模型。
 *    Ollama 不在运行时不假装成功，明确返回可执行提示；
 *  - 所有下载 URL 来自静态目录，不接受前端传路径/URL；文件名也由目录固定，避免路径穿越。
 */
@Injectable()
export class LocalModelsService {
  private readonly logger = new Logger(LocalModelsService.name);
  private readonly states = new Map<string, DownloadState>();

  constructor(private readonly settings: SettingsService) {}

  /** 模型落盘目录：允许用环境变量覆盖，默认 ~/.sciflow/models */
  private modelsDir(): string {
    const dir = process.env.SCIFLOW_MODELS_DIR?.trim()
      ? path.resolve(process.env.SCIFLOW_MODELS_DIR.trim())
      : path.join(os.homedir(), '.sciflow', 'models');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private filePath(spec: LocalModelSpec): string {
    return path.join(this.modelsDir(), spec.fileName);
  }

  private partPath(spec: LocalModelSpec): string {
    return `${this.filePath(spec)}.part`;
  }

  private async installed(spec: LocalModelSpec): Promise<boolean> {
    try {
      const st = await fs.stat(this.filePath(spec));
      return st.isFile() && st.size === spec.sizeBytes;
    } catch {
      return false;
    }
  }

  private async providerNameFor(spec: LocalModelSpec): Promise<string | undefined> {
    try {
      const providers = this.settings.listProviders() as Array<{ name?: string }>;
      return providers.find((p) => p.name === `本地 · ${spec.name}`)?.name;
    } catch {
      return undefined;
    }
  }

  /** 当前快照：已安装优先于内存态，避免服务重启后 UI 误显示“未下载” */
  private async view(spec: LocalModelSpec): Promise<LocalModelView> {
    const state = this.states.get(spec.id);
    const file = this.filePath(spec);
    const installed = await this.installed(spec);
    const downloadedBytes = installed ? spec.sizeBytes : state?.received ?? 0;
    return {
      ...spec,
      installed,
      downloadedBytes,
      status: installed ? 'installed' : state?.status ?? 'idle',
      error: installed ? undefined : state?.error,
      speedBps: installed ? 0 : state?.speedBps ?? 0,
      filePath: file,
      providerName: await this.providerNameFor(spec),
    };
  }

  async list(): Promise<LocalModelView[]> {
    return Promise.all(LOCAL_MODELS.map((m) => this.view(m)));
  }

  async status(id: string): Promise<LocalModelView> {
    const spec = this.mustFind(id);
    return this.view(spec);
  }

  async startDownload(id: string): Promise<LocalModelView> {
    const spec = this.mustFind(id);
    if (await this.installed(spec)) return this.view(spec);
    const existing = this.states.get(id);
    if (existing?.status === 'downloading' || existing?.status === 'verifying') return this.view(spec);

    const controller = new AbortController();
    const state: DownloadState = {
      id,
      status: 'downloading',
      received: 0,
      total: spec.sizeBytes,
      speedBps: 0,
      startedAt: Date.now(),
      controller,
    };
    this.states.set(id, state);
    void this.runDownload(spec, state).catch((err) => {
      this.logger.warn(`本地模型下载失败 ${id}: ${String(err?.message || err)}`);
    });
    return this.view(spec);
  }

  cancel(id: string): LocalModelView {
    const spec = this.mustFind(id);
    const state = this.states.get(id);
    if (state?.controller) state.controller.abort();
    if (state) {
      state.status = 'cancelled';
      state.speedBps = 0;
    }
    return {
      ...spec,
      installed: false,
      downloadedBytes: 0,
      status: 'cancelled',
      speedBps: 0,
      filePath: this.filePath(spec),
    };
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    const spec = this.mustFind(id);
    const state = this.states.get(id);
    if (state?.controller) state.controller.abort();
    this.states.delete(id);
    await Promise.all([
      fs.rm(this.filePath(spec), { force: true }),
      fs.rm(this.partPath(spec), { force: true }),
    ]);
    return { ok: true };
  }

  /** 探测本机 Ollama（只访问回环地址，固定端口，不接受前端传地址） */
  async ollamaStatus(): Promise<{ ok: boolean; version?: string; models?: number; error?: string }> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return { ok: false, error: `Ollama 返回 HTTP ${res.status}` };
      const body = (await res.json()) as { models?: unknown[] };
      return { ok: true, models: Array.isArray(body.models) ? body.models.length : 0 };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  /**
   * 一键导入：调用 Ollama `/api/create` 把 GGUF 注册成模型，再保存并激活 provider。
   * 失败不伪造成功，返回 code 让 UI 给出下一步。
   */
  async install(id: string): Promise<{
    ok: boolean;
    code?: 'NOT_DOWNLOADED' | 'OLLAMA_NOT_RUNNING' | 'OLLAMA_CREATE_FAILED' | 'PROVIDER_FAILED';
    message?: string;
    providerId?: string;
    ollamaModel?: string;
  }> {
    const spec = this.mustFind(id);
    if (!(await this.installed(spec))) {
      return { ok: false, code: 'NOT_DOWNLOADED', message: '模型尚未下载完成，请先下载并校验' };
    }
    if (process.env.ALLOW_PRIVATE_OUTBOUND !== '1' && process.env.SCIFLOW_DESKTOP !== '1') {
      return {
        ok: false,
        code: 'PROVIDER_FAILED',
        message: '当前实例未放行本机回环出站。请设置 ALLOW_PRIVATE_OUTBOUND=1 后重启后端；桌面端默认已放行。',
      };
    }
    const tags = await this.ollamaStatus();
    if (!tags.ok) {
      return {
        ok: false,
        code: 'OLLAMA_NOT_RUNNING',
        message:
          '未检测到本机 Ollama。请先安装并启动 Ollama（ollama serve），再回来点「导入 Ollama」；'
          + '也可以在 LM Studio / llama.cpp 中手动加载下载好的 GGUF。',
      };
    }

    const digest = `sha256:${spec.sha256}`;
    const modelfile = [
      `FROM "${this.filePath(spec).replace(/"/g, '')}"`,
      `PARAMETER num_ctx ${spec.runtimeContextWindow}`,
    ].join('\n');
    try {
      // Ollama >= 0.40 的 /api/create 只认 `from` 或 `files`，不认旧版 `modelfile`。
      // 先把 GGUF 作为 blob 上传（已存在则 HEAD 命中，避免重复传 600MB），再按 files 映射创建。
      const blobHead = await fetch(`${OLLAMA_BASE}/api/blobs/${digest}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (!blobHead?.ok) {
        const body = Readable.toWeb(createReadStream(this.filePath(spec))) as unknown as NonNullable<RequestInit['body']>;
        const upload = await fetch(`${OLLAMA_BASE}/api/blobs/${digest}`, {
          method: 'POST',
          body,
          // Node fetch 的流式请求体需要 half duplex；DOM 类型里没有这个字段
          duplex: 'half',
          headers: { 'Content-Type': 'application/octet-stream' },
          signal: AbortSignal.timeout(180_000),
        } as RequestInit & { duplex: 'half' });
        if (!upload.ok) {
          const text = (await upload.text()).slice(0, 300);
          return { ok: false, code: 'OLLAMA_CREATE_FAILED', message: `Ollama 上传模型文件失败：HTTP ${upload.status} ${text}` };
        }
      }

    const createBody = {
        model: spec.ollamaName,
        files: { [spec.fileName]: digest },
        parameters: { num_ctx: spec.runtimeContextWindow },
        stream: false,
      };
      const res = await fetch(`${OLLAMA_BASE}/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        // 兼容旧版 Ollama（<0.40）：回退到 Modelfile 方式
        if (/neither 'from' or 'files' was specified/i.test(text)) {
          const legacy = await fetch(`${OLLAMA_BASE}/api/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: spec.ollamaName, modelfile, stream: false }),
            signal: AbortSignal.timeout(120_000),
          });
          if (!legacy.ok) {
            const legacyText = (await legacy.text()).slice(0, 300);
            return { ok: false, code: 'OLLAMA_CREATE_FAILED', message: `Ollama 创建模型失败：HTTP ${legacy.status} ${legacyText}` };
          }
        } else {
          return { ok: false, code: 'OLLAMA_CREATE_FAILED', message: `Ollama 创建模型失败：HTTP ${res.status} ${text}` };
        }
      }
    } catch (err: any) {
      return { ok: false, code: 'OLLAMA_CREATE_FAILED', message: `Ollama 创建模型失败：${String(err?.message || err)}` };
    }

    try {
      const existing = (this.settings.listProviders() as unknown as Array<{ id: string; name?: string }>).find(
        (p) => p.name === `本地 · ${spec.name}`,
      );
      const saved = await this.settings.saveProvider({
        id: existing?.id,
        name: `本地 · ${spec.name}`,
        baseUrl: `${OLLAMA_BASE}/v1`,
        apiKey: 'ollama',
        model: spec.ollamaName,
        protocol: 'openai-compatible',
        contextWindow: spec.runtimeContextWindow,
        maxOutput: spec.maxOutput,
        toolCalling: spec.toolCalling ? 1 : 0,
        models: [
          {
            id: spec.ollamaName,
            displayName: spec.name,
            contextWindow: spec.runtimeContextWindow,
            maxOutput: spec.maxOutput,
            toolCalling: spec.toolCalling,
          },
        ],
      });
      // 只把模型登记为可选 provider，不替用户切换默认模型。
      // 「用哪个本地模型」由用户自己在模型列表里选择，下载中心不做强制推荐。
      return { ok: true, providerId: saved.id, ollamaModel: spec.ollamaName };
    } catch (err: any) {
      return { ok: false, code: 'PROVIDER_FAILED', message: `模型已导入 Ollama，但写入 SciFlow provider 失败：${String(err?.message || err)}` };
    }
  }

  private mustFind(id: string): LocalModelSpec {
    const spec = findLocalModel(String(id || ''));
    if (!spec) throw new NotFoundException(`未知本地模型：${id}`);
    return spec;
  }

  private async runDownload(spec: LocalModelSpec, state: DownloadState): Promise<void> {
    const part = this.partPath(spec);
    await fs.rm(part, { force: true });
    let lastAt = Date.now();
    let lastBytes = 0;
    let handle: FileHandle | undefined;
    try {
      for (const source of spec.sources) {
        try {
          const res = await fetch(source.url, {
            redirect: 'follow',
            signal: state.controller?.signal,
            headers: { 'User-Agent': 'SciFlow-LocalModelDownloader/1.0' },
          });
          if (!res.ok) throw new Error(`${source.label} 返回 HTTP ${res.status}`);
          if (!res.body) throw new Error(`${source.label} 未返回文件流`);
          const total = Number(res.headers.get('content-length') || spec.sizeBytes) || spec.sizeBytes;
          state.total = total;
          const hash = createHash('sha256');
          state.hash = '';
          handle = await fs.open(part, 'w');
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            if (state.controller?.signal.aborted) throw new Error('下载已取消');
            const buf = Buffer.from(value);
            await handle.write(buf);
            hash.update(buf);
            state.received += buf.length;
            const now = Date.now();
            if (now - lastAt >= 500) {
              state.speedBps = Math.round((state.received - lastBytes) / ((now - lastAt) / 1000));
              lastAt = now;
              lastBytes = state.received;
            }
          }
          state.hash = hash.digest('hex');
          await handle.close();
          handle = undefined;
          break;
        } catch (err) {
          await handle?.close().catch(() => undefined);
          handle = undefined;
          await fs.rm(part, { force: true }).catch(() => undefined);
          state.received = 0;
          state.speedBps = 0;
          if (state.controller?.signal.aborted) throw err;
          if (source === spec.sources[spec.sources.length - 1]) throw err;
          this.logger.warn(`下载源失败，尝试下一个：${source.label} ${String((err as Error)?.message || err)}`);
        }
      }

      state.status = 'verifying';
      const st = await fs.stat(part);
      if (st.size !== spec.sizeBytes) {
        throw new Error(`文件大小不匹配：期望 ${spec.sizeBytes}，实际 ${st.size}`);
      }
      if (state.hash && state.hash !== spec.sha256) {
        throw new Error('SHA256 校验失败，文件可能不完整或源已更新');
      }
      await fs.rename(part, this.filePath(spec));
      state.status = 'installed';
      state.received = spec.sizeBytes;
      state.total = spec.sizeBytes;
      state.speedBps = 0;
      state.controller = undefined;
      this.logger.log(`本地模型已安装：${spec.id} → ${this.filePath(spec)}`);
    } catch (err: any) {
      await handle?.close().catch(() => undefined);
      await fs.rm(part, { force: true }).catch(() => undefined);
      if (state.controller?.signal.aborted) {
        state.status = 'cancelled';
        state.error = '下载已取消';
      } else {
        state.status = 'error';
        state.error = String(err?.message || err).slice(0, 300);
      }
      state.speedBps = 0;
      state.controller = undefined;
      throw err;
    }
  }
}
