/**
 * 本地小模型推荐目录（设置页「本地模型」）。
 *
 * 选型原则（2026-11 实测定稿）：
 *  - 只放 2B 以下、上下文 ≥32K、许可允许本地部署的新模型；
 *  - 不再内置 Qwen3-0.6B / Qwen3.5-0.8B 这类旧一代或已证明 JSON 遵从率不足的模型；
 *  - 目录只负责「下载 + 校验 + 导入本机运行时」，不把模型权重打进安装包。
 *
 * 文件大小/SHA256 与 ModelScope/Hugging Face 上的固定 revision 对齐；升级模型时必须同步改这里。
 */
export interface LocalModelSource {
  /** 面向用户的下载源名称 */
  label: string;
  url: string;
}

export interface LocalModelSpec {
  id: string;
  name: string;
  vendor: string;
  /** 参数量的人类可读文本，如 1.08B */
  params: string;
  /** 模型原生上下文窗口（厂商规格） */
  contextWindow: number;
  /** 本机 Ollama 实际创建的 num_ctx；受内存限制，不能直接写原生 128K */
  runtimeContextWindow: number;
  maxOutput: number;
  license: string;
  /** 量化方式，如 Q4_K_M */
  quantization: string;
  sizeBytes: number;
  sha256: string;
  fileName: string;
  /** Ollama 中创建的模型名（小写、无点号） */
  ollamaName: string;
  description: string;
  highlights: string[];
  /** 推荐理由/限制，展示在卡片底部 */
  note?: string;
  recommended?: boolean;
  toolCalling: boolean;
  /** 该模型自带 thinking，本地 1B 级模型思考会挤占输出预算；导入时在 Ollama 模型里默认关闭。 */
  disableThinking?: boolean;
  sources: LocalModelSource[];
}
export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: 'minicpm5-1b',
    name: 'MiniCPM5-1B',
    vendor: 'OpenBMB 面壁智能',
    params: '1.08B',
    contextWindow: 131072,
    runtimeContextWindow: 16384,
    maxOutput: 4096,
    license: 'Apache-2.0',
    quantization: 'Q4_K_M',
    sizeBytes: 688065920,
    sha256: '81b64d05a23b17b34c475f42b3e72fbde62d4b92cc34541f7a8031d0752deafa',
    fileName: 'MiniCPM5-1B-Q4_K_M.gguf',
    ollamaName: 'sciflow-minicpm5-1b',
    description: '1B 级开源小模型，原生 128K 上下文；官方定位为端侧 Agent、代码与高难推理，通用知识明显强于同尺寸旧模型。',
    highlights: ['128K 原生上下文', '1B 级综合能力', 'Apache-2.0 可商用', 'GGUF 直接加载'],
    note: '实测：SciFlow 结构化 JSON 遵从率 60%，适合本地问答/草稿/长文摘要；研究规划、大纲、评审等强结构任务仍建议走云端 strong 档。',
    toolCalling: true,
    disableThinking: true,
    sources: [
      {
        label: 'ModelScope（国内推荐）',
        url: 'https://modelscope.cn/models/OpenBMB/MiniCPM5-1B-GGUF/resolve/master/MiniCPM5-1B-Q4_K_M.gguf',
      },
      {
        label: 'Hugging Face',
        url: 'https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q4_K_M.gguf',
      },
    ],
  },
  {
    id: 'botpsy-0.8b',
    name: 'BotPsy-0.8B',
    vendor: 'Tether / QVAC',
    params: '0.8B',
    contextWindow: 32768,
    runtimeContextWindow: 16384,
    maxOutput: 2048,
    license: 'Apache-2.0',
    quantization: 'Q4_K_M',
    sizeBytes: 529296960,
    sha256: '482db2dfdbc8ab7db3d3216fd8ef071d7381dd8547aff9933bc03312839d4d83',
    fileName: 'botpsy-0.8b-q4_k_m-imat.gguf',
    ollamaName: 'sciflow-botpsy-0.8b',
    description: '面向端侧 Agent 的工具调用专精模型，基于 Qwen3.5-0.8B 微调；厂商公布的 BFCL v4 / τ-bench 等工具基准显著高于同尺寸通用模型。',
    highlights: ['工具调用专精', '32K 运行窗口', '0.8B 超轻量', 'Apache-2.0 可商用'],
    note: '实测：SciFlow 结构化 JSON 遵从率 90%，但通用知识与长文能力弱于 MiniCPM5-1B；适合工具路由/短任务，不建议单独承担长文写作。',
    toolCalling: true,
    disableThinking: true,
    sources: [
      {
        label: 'Hugging Face',
        url: 'https://huggingface.co/qvac/BotPsy-0.8B-GGUFs/resolve/main/botpsy-0.8b-q4_k_m-imat.gguf',
      },
    ],
  },
];

export function findLocalModel(id: string): LocalModelSpec | undefined {
  return LOCAL_MODELS.find((m) => m.id === id);
}
