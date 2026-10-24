/**
 * 本地 Mock OpenAI 兼容网关（MSW 拦截器方案，替代 node:http 原始服务器）
 * ============================================================================
 * 用途：在没有 AI_API_KEY、没有外网的本机环境下，让 SciFlow 的 AI 调用全部落到
 *       MSW 拦截层上，从而跑通全链路端到端验证与回归测试。
 *
 * 启用方式：AI_MOCK=1（由 ai.service.ts 读取，调用 startMockGateway() 激活）
 *
 * 改进（vs 旧版 node:http 方案）：
 *   - 路由表是声明式 handler 数组，而非 24 分支 switch/case
 *   - handler 可独立测试、可复用
 *   - 不再需要原始 HTTP 服务器、端口管理、SSE 手工拼接
 *
 * 路由表覆盖的 prompt 形态与旧版完全一致（保持回归兼容）。
 * ============================================================================
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { randomUUID } from 'node:crypto';

/**
 * mock 大纲的确定性内容（单一来源）。
 * 回归与契约测试从这里取期望值，避免"测试自己写一份、实现另有副本"的漂移。
 */
export const MOCK_OUTLINE = {
  title: '图神经网络研究综述：从消息传递到几何深度学习',
  sections: [
    { title: '引言', subsections: ['研究背景', '本文贡献'] },
    { title: '相关工作', subsections: ['图表示学习', '消息传递范式'] },
    { title: '方法', subsections: ['GCN', 'GraphSAGE', 'GAT'] },
    { title: '结果与讨论', subsections: ['节点分类任务表现', '局限与挑战'] },
    { title: '结论', subsections: ['总结', '未来方向'] },
  ],
} as const;

/** 是否处于 mock 模式（与 ai.service.ts 同一判定） */
export function isMockMode(): boolean {
  return process.env.AI_MOCK === '1';
}

// ---------------------------------------------------------------------------
// 响应构造器（保持与旧版 OpenAI 兼容的响应结构）
// ---------------------------------------------------------------------------

export function jsonCompletion(content: string) {
  return {
    id: `chatcmpl-mock-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: Math.max(1, Math.floor(content.length / 2)),
      total_tokens: 12 + Math.max(1, Math.floor(content.length / 2)),
    },
  };
}

function j(obj: unknown): string {
  return JSON.stringify(obj);
}

/** 从 POLISH prompt 中抽出「待处理文本」原文 */
function extractPolishText(prompt: string): string {
  const start = prompt.indexOf('待处理文本：');
  if (start < 0) return prompt;
  let body = prompt.slice(start + '待处理文本：'.length);
  const endMarkers = ['\n\n请只输出一个合法', '\n\n要求：'];
  for (const m of endMarkers) {
    const idx = body.indexOf(m);
    if (idx >= 0) body = body.slice(0, idx);
  }
  return body.trim();
}

/** 从「提炼研究题目」prompt 中抽出主题原文 */
function extractTopic(prompt: string): string {
  const idx = prompt.lastIndexOf('\n');
  const t = idx >= 0 ? prompt.slice(idx + 1) : prompt;
  return t.trim() || '图神经网络在生物医药中的应用综述';
}

interface RouteRule {
  /** 匹配函数：从 user content 判断是否命中此规则 */
  matches: (prompt: string) => boolean;
  /** 返回响应内容字符串（会按请求 stream 标志自动封装为 SSE 或 JSON） */
  respond: (prompt: string) => string;
}

const ROUTE_TABLE: RouteRule[] = [
  // 0) 连接测试
  { matches: (p) => p.includes('请只回复两个字：正常'), respond: () => '正常' },
  // 1) Planner 研究计划
  { matches: (p) => p.includes('科研规划专家') && p.includes('researchQuestions'), respond: () => j({ objective: '围绕给定主题完成一篇系统性综述，覆盖方法演进、代表工作与应用前景。', researchQuestions: ['该主题的核心方法演进脉络是什么？', '代表性模型/工作有哪些共性与差异？', '在目标场景下的应用价值与局限如何？'], searchStrategy: { keywords: ['graph neural network', '图神经网络', '消息传递', 'node classification'], minPapers: 8, depth: 'overview' }, draftingPlan: { sections: ['引言', '相关工作', '方法', '结果与讨论', '结论'], wordCount: 5000 }, risks: ['公开文献时效性不足', '跨领域术语口径差异'] }) },
  // 1.5) F2 反共识大纲变体（必须在大纲规则之前匹配：prompt 同样包含「设计论文大纲」与 "sections"）
  { matches: (p) => p.includes('反共识') && p.includes('"primary"'), respond: () => j({ primary: MOCK_OUTLINE, variants: [{ title: '主流范式的系统性缺陷：对消息传递统一框架的质疑', sections: [{ title: '引言：被掩盖的失败案例', subsections: ['主流叙事如何形成'] }, { title: '消息传递的表达力上界', subsections: ['理论反例'] }, { title: '反例与边界条件', subsections: ['异质图失效场景'] }, { title: '重构研究议程', subsections: ['超越消息传递'] }] }, { title: '以负结果为中心的图神经网络研究断代史', sections: [{ title: '引言：负结果的认识论价值', subsections: [] }, { title: '第一次浪潮及其退潮', subsections: ['谱方法为何沉寂'] }, { title: '断代框架', subsections: ['按学派论战重组'] }, { title: '对未来的启示', subsections: [] }] }] }) },
  // 1.6) F3 实验设计助手
  { matches: (p) => p.includes('实验设计') && p.includes('"sampleHint"'), respond: () => j({ objective: '验证时序感知聚合相对均匀采样能显著提升动态图节点分类性能', variables: { independent: ['邻居采样是否引入时序衰减因子（有/无）'], dependent: ['节点分类 Macro-F1'], controlled: ['训练轮数=200', '隐藏维度=64', '数据集划分固定种子'] }, groups: [{ name: '实验组', role: 'treatment', description: '时序感知采样聚合' }, { name: '对照基线', role: 'control', description: '标准 GraphSAGE 均匀采样' }], sampleHint: '每配置 5 个随机种子，报均值±标准差；配对 t 检验 α=0.05，power≥0.8', procedure: ['固定数据集与划分', '训练实验组与对照组', '汇总指标并做显著性检验'], analysisPlan: ['主指标 Macro-F1 对比表', '消融：去掉时序衰减因子'], risks: ['动态图数据集规模有限，方差可能偏大'] }) },
  // 2) 论文大纲
  { matches: (p) => p.includes('设计论文大纲') && p.includes('"sections"'), respond: () => j(MOCK_OUTLINE) },
  // 3) ReAct 思考步 —— 一律 done
  { matches: (p) => p.includes('自主研究执行器') && p.includes('action'), respond: () => j({ thought: '信息已基本覆盖，进入综合写作阶段。', action: 'done', query: '', coverage: 90 }) },
  // 4) Reflexion 反思
  { matches: (p) => p.includes('上一轮论文质量评审给出的问题如下'), respond: () => j({ note: '补充近三年文献并规范引用', instructions: ['在相关工作节补充近三年代表性文献', '方法节补充数据集与超参数说明', '统一图表标注格式'] }) },
  // 5) 章节起草
  { matches: (p) => p.includes('学术论文写作者') && p.includes('起草论文的一个章节'), respond: () => ['近年来，图神经网络（Graph Neural Networks, GNN）在处理图结构数据方面取得了显著进展[Ref:1]。与传统深度学习模型只能处理规整张量不同，GNN 能够直接对节点与边构成的拓扑结构进行表示学习[Ref:2]。', '主流方法遵循消息传递范式：每个节点在每一轮中聚合其邻居的特征表示，经非线性变换后更新自身状态[Ref:1]。GCN 采用归一化邻域求和，GraphSAGE 通过采样与拼接提升可扩展性，GAT 则引入注意力机制自适应地衡量邻居重要性[Ref:2]。', '在节点分类任务上，上述模型均取得了优于传统方法的性能表现，但在大规模图与异质图场景下仍存在计算开销大、泛化性不足等挑战[Ref:1]。'].join('\n\n') },
  // 6) 7 维评审
  { matches: (p) => p.includes('同行评审专家') && p.includes('"scores"'), respond: () => j({ scores: { literature: 88, logic: 86, citation: 90, language: 89, novelty: 84, figures: 85, format: 87 }, feedback: '整体结构完整、论证链清晰；建议补充近三年文献的对比分析；图表标注可进一步统一规范。' }) },
  // 7) 润色
  { matches: (p) => p.includes('学术语言编辑') && p.includes('polished'), respond: (p) => { const original = extractPolishText(p); return j({ original, polished: original, reason: 'mock 确定性润色：保留原意与专业术语，规范学术表达与段落衔接。' }); } },
  // 8) 学术翻译
  { matches: (p) => p.includes('学术翻译专家'), respond: () => '图神经网络是一类强大的深度学习模型，专为图结构数据的表示学习而设计。' },
  // 9) 文献综述
  { matches: (p) => p.includes('文献综述专家'), respond: () => '现有研究沿「消息传递 → 注意力聚合 → 几何归纳偏置」三条主线推进图神经网络发展[Ref:1]。早期 GCN 通过谱域与空域近似建立可训练的图卷积算子[Ref:2]，后续工作在可扩展性与表达能力上持续改进。总体而言，方法已在节点分类、链接预测等任务上验证有效，但面向动态图与大规模图的高效推理仍是开放问题。' },
  // 10) 期刊推荐
  { matches: (p) => p.includes('推荐 3-5 个合适的投稿期刊'), respond: () => '1. 《计算机学报》——方向高度匹配，审稿周期约 3-4 个月。\n2. 《软件学报》——中文核心，重视方法严谨性。\n3. IEEE TKDE（请以官方分区为准）——国际高被引期刊，适合完整方法与实验工作。' },
  // 11) Cover Letter
  { matches: (p) => p.includes('Cover Letter') || p.includes('投稿信'), respond: () => 'Dear Editor,\n\nWe are pleased to submit our manuscript for consideration. This work presents a systematic survey of graph neural networks, covering message-passing paradigms, representative architectures, and applications. We believe it fits the journal\'s scope. The manuscript is original and has not been submitted elsewhere.\n\nSincerely,\nThe Authors' },
  // 12) 审稿回复信
  { matches: (p) => p.includes('审稿意见撰写回复信') || p.includes('Response to Reviewers') || p.includes('审稿意见'), respond: () => 'Response to Reviewers:\n\nComment: The method section needs more detail.\nResponse: We have expanded Section 3 with dataset descriptions, hyperparameter settings and training protocols. Please see the revised manuscript.' },
  // 13) RAG 知识库问答
  { matches: (p) => p.includes('只依据') && p.includes('知识库资料'), respond: () => '根据知识库资料：图神经网络通过消息传递机制聚合邻居节点特征，在节点分类任务上表现优异【来源1】。知识库未覆盖的方面：具体的工程实现细节与超参数取值。' },
  // 14) 文献结构化提取
  { matches: (p) => p.includes('文献列表做结构化提取') || p.includes('结构化提取'), respond: () => j({ papers: [{ ref: '1', title: 'Graph Neural Networks: A Review', year: 2020, method: '系统性综述', results: '梳理了 GCN/GraphSAGE/GAT 等代表模型', contribution: '统一消息传递视角', limitations: '缺少动态图讨论' }] }) },
  // 15) 证据综合
  { matches: (p) => p.includes('循证综述专家'), respond: () => j({ summary: '现有证据总体支持图神经网络在图结构任务上的有效性，结论一致性较好。', stances: [{ claim: '消息传递能提升节点表示质量', stance: '支持', count: 3, refs: ['1'], note: '多篇文献报告一致正向结果' }] }) },
  // 16) 摘要 + 关键词
  { matches: (p) => p.includes('生成符合学术规范的摘要与关键词'), respond: () => j({ abstract: '本文系统综述图神经网络的方法演进与应用现状。首先梳理消息传递范式，随后对比 GCN、GraphSAGE、GAT 等代表架构的优劣，最后讨论其在生物医药等领域的应用前景与开放挑战。', keywords: ['图神经网络', '消息传递', '节点分类'] }) },
  // 17) 单篇文献深度精读
  { matches: (p) => p.includes('结构化深度解读') && p.includes('keyFindings'), respond: () => j({ title: 'Graph Neural Networks: A Review', oneLine: '系统综述图神经网络方法谱系', researchQuestion: '如何统一理解各类 GNN 的表示学习机制', motivation: 'GNN 已广泛应用但方法零散缺乏统一框架', method: '按消息传递范式分类对比代表模型', keyFindings: ['消息传递是主流统一范式', '注意力机制提升了邻域加权能力', '可扩展性仍是大规模图的瓶颈'], limitations: ['动态图讨论不足'], futureWork: '面向动态图与异质图的高效聚合算子', takeaway: '理解消息传递范式是掌握 GNN 的关键。' }) },
  // 18) 研究缺口
  { matches: (p) => p.includes('尚未被充分研究') && p.includes('recommendedTopic'), respond: () => j({ gaps: [{ gap: '动态图场景下的高效消息传递聚合研究不足', evidence: '现有综述[Ref:1]以静态图为主', opportunity: '设计时序感知的邻居采样算子', feasibility: '中：公开动态图数据集可得' }], recommendedTopic: '面向动态图的时序感知消息传递图神经网络研究' }) },
  // 19) 自动配图
  { matches: (p) => p.includes('学术论文图表设计专家') && p.includes('学术图表'), respond: () => j({ figures: [{ figureType: 'flowchart', title: '图 1：技术路线', caption: '从原始图数据到节点表示与下游任务的整体流程', mermaid: 'flowchart TD\nA[原始图数据]-->B[消息传递聚合]\nB-->C[节点表示]\nC-->D[节点分类]\nC-->E[链接预测]' }] }) },
  // 20) 情景记忆压缩
  { matches: (p) => p.includes('压缩为一条情景记忆') && p.includes('keywords'), respond: () => j({ content: '完成图神经网络综述写作，采用引言-相关工作-方法-讨论-结论结构，质量评分优良', keywords: ['图神经网络', '综述', '消息传递'] }) },
  // 21) 结构化期刊匹配
  { matches: (p) => p.includes('学术投稿顾问') && p.includes('"journals"'), respond: () => j({ journals: [{ name: '计算机学报', score: 86, reason: '方向高度匹配，中文核心期刊', gap: '需补充与近三年方法的定量对比' }, { name: '软件学报', score: 80, reason: '重视方法严谨性与实验完备性', gap: '建议补充消融实验' }] }) },
  // 22) 投稿邮件解析
  { matches: (p) => p.includes('阅读下面这封编辑部来稿邮件') && p.includes('suggestedStatus'), respond: () => j({ suggestedStatus: 'minor_revision', confidence: 0.9, reason: '邮件明确小修后录用', date: '2026-10-31' }) },
  // 23) 主题提炼
  { matches: (p) => p.includes('把以下研究主题提炼为一句可执行的研究题目'), respond: (p) => extractTopic(p) },
];

/**
 * 默认兜底回复（通用科研问答）。
 * 用途仅限 mock 演示/测试；带 Markdown 结构以便验证前端渲染（标题/列表/公式/代码块/表格）。
 */
const FALLBACK_REPLY = [
  '这是 **本地 mock 网关** 的示例回复（未接入真实模型）。接上任意 OpenAI 兼容端点后即为真实回答。',
  '',
  '### 消息传递（Message Passing）三步',
  '1. **消息生成**：每条边 (i→j) 上计算 m_ij = φ(h_i, h_j, e_ij)',
  '2. **聚合**：节点 j 汇总邻居消息 a_j = ⊕_{i∈N(j)} m_ij（sum / mean / max / attention）',
  '3. **更新**：h_j′ = ψ(h_j, a_j)',
  '',
  '$$h_j^{(l+1)} = \\sigma\\Big(W\\sum_{i \\in \\mathcal{N}(j)} \\frac{1}{c_{ij}} h_i^{(l)}\\Big)$$',
  '',
  '```python',
  'import torch',
  'from torch_geometric.nn import GCNConv',
  '',
  'conv = GCNConv(in_channels=64, out_channels=32)',
  'h = conv(x, edge_index)   # 一次消息传递',
  '```',
  '',
  '| 变体 | 聚合方式 | 特点 |',
  '| --- | --- | --- |',
  '| GCN | 归一化求和 | 简单、稳定 |',
  '| GAT | 多头注意力 | 区分邻居重要性 |',
  '| E(3)-GNN | 等变聚合 | 三维分子适用 |',
  '',
  '> 提示：以上内容由本地 mock 生成，仅用于界面演示。',
].join('\n');

/** OpenAI 兼容模型列表响应体（MSW 拦截与 HTTP 包装脚本共用） */
export const MOCK_MODELS_BODY = {
  object: 'list',
  data: [{ id: 'mock-model', object: 'model', created: 0, owned_by: 'local-mock' }],
};

/**
 * 从请求体抽取最后一个 user message 并按路由表匹配出确定性响应内容。
 * MSW 进程内拦截与 HTTP 包装脚本（apps/server/scripts/mock-openai-http.mjs）共用同一事实源。
 */
export function mockContentFromBody(body: unknown): string {
  const prompt = getLastUserContent(body);
  for (const rule of ROUTE_TABLE) {
    if (rule.matches(prompt)) return rule.respond(prompt);
  }
  return FALLBACK_REPLY;
}

// ---------------------------------------------------------------------------
// MSW handler：从请求体中抽出最后一个 user message 并按路由表匹配
// ---------------------------------------------------------------------------

function getLastUserContent(body: any): string {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]?.content) return String(messages[i].content);
  }
  return messages.length ? String(messages[messages.length - 1]?.content || '') : '';
}

const mockHandlers = [
  // GET */models — 模型列表（* 不限路径前缀：ark /api/v3/models、openai /v1/models 都拦）
  http.get('*/models', () => {
    return HttpResponse.json(MOCK_MODELS_BODY);
  }),
  // POST */chat/completions — 统一入口（流式 + 非流式）。
  // 历史缺陷（v1.0 修复）：只拦 */v1/chat/completions，而国内厂商多为 /v3 /v4 /compatible-mode/v1——
  // 模式不匹配时 MSW 默认 bypass，请求会打穿到真实端点（假 mock + 真流量）。
  http.post('*/chat/completions', async ({ request }) => {
    let parsed: any = {};
    try {
      parsed = await request.json();
    } catch { /* 空体 */ }
    const content = mockContentFromBody(parsed);
    if (parsed.stream) {
      // 返回 MSW 原生 Response（ReadableStream body）
      return new HttpResponse(sseStreamBody(content, !!parsed.stream_options?.include_usage), {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }
    return HttpResponse.json(jsonCompletion(content));
  }),
];

/** 构造 SSE stream body（Uint8Array ReadableStream；HTTP 包装脚本复用） */
export function sseStreamBody(content: string, includeUsage: boolean): ReadableStream<Uint8Array> {
  const id = `chatcmpl-mock-${randomUUID()}`;
  const encoder = new TextEncoder();
  const chunkSize = 12;
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < content.length; i += chunkSize) {
        const delta = content.slice(i, i + chunkSize);
        const chunk = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`));
      if (includeUsage) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [], usage: { prompt_tokens: 12, completion_tokens: content.length, total_tokens: 12 + content.length } })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// 公开 API（与旧版保持同名同签名，ai.service.ts 无需修改调用方式）
// ---------------------------------------------------------------------------

let server: ReturnType<typeof setupServer> | null = null;

/** 启动 MSW 拦截层（返回 baseUrl —— 无需端口，任何 URL 都会被 MSW 拦截） */
export function startMockGateway(): string {
  if (!server) {
    server = setupServer(...mockHandlers);
    server.listen();
    console.log('[mock-gateway] MSW mock 层已激活（拦截所有 fetch 请求，仅本机测试用）');
  }
  // 必须返回虚拟 /v1 baseUrl（v1.0 修复）：此前透传 AI_BASE_URL（如 ark 的 /v3），
  // 与拦截模式 */v1/chat/completions 不匹配时 MSW bypass → 打穿真实端点。
  return 'http://mock.local/v1';
}

/** 关闭 MSW 拦截层 */
export function stopMockGateway(): void {
  if (server) {
    server.close();
    server = null;
  }
}

/** 测试用：动态追加路由规则（无需重启服务） */
export function addMockRoute(rule: RouteRule): void {
  ROUTE_TABLE.push(rule);
}

/** 测试用：清空自定义路由（保留内建规则） */
export function clearMockRoutes(): void {
  ROUTE_TABLE.splice(0, ROUTE_TABLE.length);
}
