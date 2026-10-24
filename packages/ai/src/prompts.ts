/**
 * 科研任务 Prompt 模板集
 * 借鉴开源项目模式：
 * - GPT-Academic：润色输出「原文+润色文+润色理由」三段式对比
 * - Academic Research Skills：7 维质量评分关卡、引用核验意识
 * - STORM：outline-first 大纲先行写作流程
 * - Agent Laboratory：分阶段流水线 + 人工反馈
 */

export const PLAN_RESEARCH = (topic: string) => `
你是科研规划专家。请为下述研究主题制定检索规划，输出研究目标、researchQuestions 与检索策略。

研究主题：${topic}

写作类型感知（重要）：若研究主题属于综述/比较研究，章节不得包含「实验与结果」这类实证章节（评审会判定逻辑断裂），应以「方法对比与分析」「证据与案例讨论」等替代；仅当主题明确为实证研究时才保留实验章节。

请输出严格的 JSON（不要任何其他文字），结构如下：
{
  "objective": "一句话研究目标",
  "researchQuestions": ["子问题1", "子问题2", "子问题3"],
  "searchStrategy": {
    "keywords": ["英文关键词1", "英文关键词2", "中文关键词1", "中文关键词2"],
    "depth": "overview"
  }
}
说明：keywords 同时给出英文与中文检索词（用于本地文献库/知识库检索），3-6 个为宜。
`;

export const WRITE_OUTLINE = (topic: string, literatureSummary: string) => `
你是一位资深学术写作专家。请为一个研究主题设计论文大纲（outline-first 方法，先大纲后成文）。

研究主题：${topic}
文献综述摘要：${literatureSummary || '（暂无，按通用学术结构设计）'}

请输出严格的 JSON（不要任何其他文字），结构如下：
{
  "title": "论文标题",
  "sections": [
    {"title": "章节标题", "subsections": ["小节1", "小节2"]}
  ]
}
要求：
- 包含引言、相关工作/文献综述、方法、实验/结果、讨论、结论等标准学术章节
- 章节标题具体、有学术性，不要泛泛的"引言""方法"
- 章节数量 6-8 个`;

/**
 * F2 反同质化引擎：主大纲 + 2 个「反共识」变体（对标 STORM 多视角大纲）。
 * 反共识 = 刻意挑战领域主流叙事：质疑主流假设、纳入异见/负结果文献、改变论证顺序或立场。
 */
export const WRITE_OUTLINE_VARIANTS = (topic: string, literatureSummary: string) => `
你是一位资深学术写作专家。请为一个研究主题设计论文大纲：先给一个主流立场的主推大纲，再给两个「反共识」变体大纲（用于打破同质化写作）。

研究主题：${topic}
文献综述摘要：${literatureSummary || '（暂无，按通用学术结构设计）'}

请输出严格的 JSON（不要任何其他文字），结构如下：
{
  "primary": { "title": "论文标题", "sections": [{"title": "章节标题", "subsections": ["小节1", "小节2"]}] },
  "variants": [
    { "title": "反共识标题A", "sections": [{"title": "章节标题", "subsections": ["小节1"]}] },
    { "title": "反共识标题B", "sections": [{"title": "章节标题", "subsections": ["小节1"]}]}
  ]
}
要求：
- primary：包含引言、相关工作/文献综述、方法、实验/结果、讨论、结论等标准学术章节，章节数量 6-8 个，章节标题具体、有学术性
- variants 恰好 2 个，每个 4-6 章，与 primary 的差异必须实质：
  - 变体 A「挑战共识」：以质疑领域主流假设/方法局限为主线，安排「主流方法的系统性缺陷」「反例与边界条件」类章节
  - 变体 B「另起框架」：换一种组织框架（如按学派论战、按时间断代、按任务场景、或以负结果/失败案例为中心）重组同一主题
- 三个大纲都不得虚构具体文献；标题具体、有学术性，不要泛泛的"引言""方法"`;

/** F3 实验设计助手：研究问题 → 结构化实验设计稿（变量表/对照组/功效提示/流程/分析计划） */
export const EXPERIMENT_DESIGN = (question: string, papers: string) => `
你是一位跨领域实验设计专家（覆盖计算机/生物医学/社科实证研究）。研究者提出以下研究问题，请给出一份可直接执行的结构化实验设计稿。

研究问题：${question}

相关文献（标题/方法/结论，供设计参照，可空）：
${papers || '（暂无，请基于通用实验设计方法论给出）'}

请只输出一个合法的纯 JSON 对象（禁止任何 markdown 代码围栏或前后缀文字，不要反引号）；JSON 字符串内的换行必须使用 \\n 转义，禁止字面换行。JSON 结构：
{
  "objective": "一句话实验目标（可证伪的假设形式）",
  "variables": {
    "independent": ["自变量 1（如何操纵、水平数）"],
    "dependent": ["因变量 1（如何测量、指标名）"],
    "controlled": ["需控制的混杂变量 1（如何固定）"]
  },
  "groups": [
    { "name": "实验组", "role": "treatment", "description": "处理内容一句话" },
    { "name": "对照组", "role": "control", "description": "基线内容一句话" }
  ],
  "sampleHint": "样本量/重复次数建议与统计功效说明（如：每组 5 个随机种子，配对 t 检验 α=0.05，power≥0.8）",
  "procedure": ["步骤 1", "步骤 2", "步骤 3"],
  "analysisPlan": ["分析 1：主指标与统计方法", "分析 2：消融/稳健性检验"],
  "risks": ["主要效度威胁或执行风险 1"]
}
要求：groups 至少含一个 treatment 与一个 control（若为纯观测研究，对照组写「自然基线」并说明）；independent/dependent/controlled 各 1-4 条；procedure 3-6 步；analysisPlan 1-4 条；risks 1-3 条；全部中文。`;

export const DRAFT_SECTION = (sectionTitle: string, outline: string, references: string) => `
你是一位学术论文写作者。请起草论文的一个章节。

章节：${sectionTitle}
论文大纲（供上下文参考）：${outline}
可用文献（编号即引用键，只允许引用下面这些文献，禁止编造）：
${references || '（无可用文献）'}

写作要求：
- 直接输出章节正文（Markdown 格式）
- 每处事实性陈述、观点引用，必须用 [Ref:编号] 标注来源文献
- 学术语气、逻辑连贯、段落衔接自然
- 篇幅：800-1500 字
- 学术诚信硬约束：严禁虚构一手实验数据、性能数值（如"准确率提升 X%"）或未发表的实验结果；如需提及实验结论或指标，必须来自上面给定的文献并用 [Ref:编号] 标注；综述类章节只总结文献观点，不撰写"我们进行了实验"式的原始研究内容`;

export const POLISH = (text: string, mode: string) => `
你是一位学术语言编辑。请对下面的文本进行「${mode}」处理（mode 为 polish=学术润色 / reduce=降重改写）。

待处理文本：
${text}

请只输出一个合法的纯 JSON 对象（禁止任何 markdown 代码围栏或前后缀文字，不要反引号）；JSON 字符串内的换行必须使用 \\n 转义，禁止字面换行。JSON 结构：
{
  "original": "原文（逐字保留）",
  "polished": "处理后的文本",
  "reason": "处理说明：分点说明改了什么、为什么（2-4 点）"
}
要求：保留原意与专业术语，提升学术表达、逻辑与规范；降重时保持语义等价但句式表达彻底不同。`;

export const TRANSLATE = (text: string, targetLang: string) => `
你是一位专业的学术翻译专家。请将下面文本翻译成${targetLang === 'zh' ? '中文' : '英文'}。
只输出译文正文，不要任何解释。

待翻译文本：
${text}`;

export const REVIEW_PAPER = (title: string, content: string) => `
你是一位严格的同行评审专家（含"魔鬼代言人"视角，专门挑刺）。请对以下论文稿件进行 7 维质量评审，输出 0-100 分。

论文标题：${title}
论文正文：
${content}

请只输出一个合法的纯 JSON 对象（禁止任何 markdown 代码围栏或前后缀文字，不要反引号）；JSON 字符串内的换行必须使用 \\n 转义，禁止字面换行。JSON 结构：
{
  "scores": {
    "literature": 0, "logic": 0, "citation": 0, "language": 0, "novelty": 0, "figures": 0, "format": 0
  },
  "feedback": "总体评价与改进建议（分点列出最关键的问题）"
}
评分维度说明：
- literature 文献充分性（是否覆盖相关研究）
- logic 逻辑一致性（论证链是否完整）
- citation 引用规范性（引用是否真实、格式是否规范）
- language 语言质量（学术表达、语法）
- novelty 创新性（贡献是否新颖）
- figures 图表质量（图表与正文一致性）
- format 格式规范性（结构、排版）
每维 0-100。总分为各维平均分。

评分锚点（各维度分别套用，减少主观漂移）：
- 80-100 优秀：达到发表水平；60-79 合格：方向正确、有明确改进点；40-59 待改：存在显著缺陷；0-39 严重缺陷。
维度独立性要求（重要）：
- 各维度独立评分，互不连坐。例如引用存疑主要扣 citation（可大幅扣），但 language/logic/format 等维度应按正文实际水平照常给分。
- 若你依据自身知识判断某条参考文献疑似不实或无法核实，在 feedback 中逐条明确指出（给出文献编号），措辞用"疑似/无法核实"，不要臆断学术不端。
- feedback 分点列出最关键问题（按对发表的影响排序，最多 6 点）。`;

export const SUMMARIZE_LITERATURE = (topic: string, papers: string) => `
你是一位文献综述专家。请基于下面提供的文献列表，写一段结构化的文献综述。

研究主题：${topic}
文献列表（编号即引用键）：
${papers}

输出要求：
- 按主题/流派/时间线组织（不要逐篇罗列）
- 每处观点必须用 [Ref:编号] 绑定到具体文献
- 结尾给出研究空白与未来方向
- 只综述提供的文献，禁止补充或编造文献
- Markdown 格式，400-800 字`;

export const RECOMMEND_JOURNAL = (title: string, abstract: string, field: string) => `
你是一位学术出版顾问。请根据论文信息推荐 3-5 个合适的投稿期刊。

论文标题：${title}
摘要：${abstract}
领域：${field}

输出要求：
- 每个期刊给出：期刊名、匹配理由、影响因子/分区（如有把握则注明"请以官方为准"）、审稿周期预期
- 从高到低按投稿难度排列
- 中文输出，编号列出`;

export const COVER_LETTER = (title: string, abstract: string, journal: string) => `
你是一位学术写作专家。请为一篇论文撰写投递给 ${journal} 期刊的 Cover Letter（投稿信）。

论文标题：${title}
摘要：${abstract}

输出要求：
- 英文撰写（学术投稿通用语言）
- 结构：主编称呼 → 论文介绍 → 为什么适合该期刊 → 创新点声明（未一稿多投等）
- 语气专业、简洁`;

export const REPLY_REVIEW = (reviewComments: string, response: string) => `
你是一位有经验的科研作者。请针对审稿意见撰写回复信（Response to Reviewers）。

审稿意见：
${reviewComments}
你的初步回应想法（可选）：
${response || '（无）'}

输出要求：
- 逐条回复格式：Quote（引用审稿意见原文）→ Response（你的回应，说明如何修改）
- 对可接受的建议说明如何修改；对不认同的建议礼貌说明理由
- 英文撰写，专业礼貌`;

export const CHAT_SYSTEM = `
你是一位全自动 AI 科研助手（SciFlow），擅长：论文写作、文献调研、学术翻译润色、数据分析方法、投稿策略、科研方法论。
回答要专业、准确、结构化；涉及具体文献或数据时，说明信息来源与不确定性；不编造引用。`;

/** NotebookLM 式：基于知识库资料的问答（答案只来自资料） */
export const KNOWLEDGE_QA = (question: string, chunks: string) => `
你是一位严谨的科研助手。请**只依据**下面提供的知识库资料回答问题。这是硬性约束：
- 答案中的每个事实/观点，必须来自资料原文，并在句尾标注来源，格式：【来源N】
- 资料中没有的信息，明确说"知识库中未提及"，不要推测或补充外部知识
- 结构化输出：先给结论，再给要点（带来源标注），最后列出"知识库未覆盖"的方面

用户问题：${question}

知识库资料：
${chunks}`;

/** Elicit 式：文献结构化提取（方法/结果/贡献/局限 对比表） */
export const EXTRACT_PAPER_TABLE = (papers: string) => `
你是一位系统综述分析师。请对下面文献列表做结构化提取，输出严格的 JSON（不要任何其他文字）：
{
  "papers": [
    {
      "ref": "编号",
      "title": "标题",
      "year": 年份,
      "method": "研究方法（一句话，中文）",
      "results": "关键结果（一句话，中文）",
      "contribution": "核心贡献（一句话，中文）",
      "limitations": "局限（一句话，中文）"
    }
  ]
}
要求：信息只能来自文献的标题/摘要/年份，不得编造；信息不足的字段写"未提及"。

文献列表：
${papers}`;

/** Consensus 式：证据综合（观点 + 支持/矛盾 + 证据强度） */
export const EVIDENCE_SYNTHESIS = (question: string, papers: string) => `
你是一位循证综述专家。请针对研究问题，综合下面文献的证据，输出严格的 JSON（不要任何其他文字）：
{
  "summary": "总体结论（100-150 字，中文，说明证据充分性）",
  "stances": [
    {
      "claim": "一个可验证的论断",
      "stance": "支持 | 部分支持 | 矛盾 | 证据不足",
      "count": 支持该论断的文献数量,
      "refs": ["支持该论断的文献编号"],
      "note": "简短说明（中文）"
    }
  ]
}
要求：论断必须来自文献；只综合提供的文献；按文献的标题/摘要判断立场。

研究问题：${question}

文献列表：
${papers}`;

/** Phase 2：情景记忆检索（从历史任务中提取与当前主题相关的先验） */
export const EPISODIC_EXTRACT = (projectName: string, docTitle: string, outline: string, score: number) => `
请把一次完成的科研写作任务压缩为一条情景记忆，输出严格 JSON（不要任何其他文字）：
{
  "content": "本次任务要点（60 字内，中文）：主题、采用的结构、质量评分",
  "keywords": ["主题词", "方法词", "结构词"]
}

项目名：${projectName}
论文标题：${docTitle}
大纲：${outline.slice(0, 400)}
质量评分：${score}/100`;

/* ============ 科研增强（Research Boost） ============ */

/** 研究设计诊断：基于研究想法 + 相关文献，评估新颖性与可行性并给方法建议 */
export const DESIGN_REVIEW = (idea: string, papers: string) => `
你是一位资深科研导师（覆盖计算机/生物医学/社科等跨领域研究设计）。研究者提出以下研究想法，并检索到相关文献。请严格评估这个想法值不值得做、怎么做。

研究想法：
${idea}

相关文献（标题/年份/方法/结论）：
${papers || '（暂无，请基于通用科研方法论评估）'}

请只输出一个合法的纯 JSON 对象（禁止任何 markdown 代码围栏或前后缀文字，不要反引号）；JSON 字符串内的换行必须使用 \\n 转义，禁止字面换行。JSON 结构：
{
  "noveltyScore": 0,
  "noveltyFeedback": "新颖性评估：与现有工作的差异化程度、创新点是否成立",
  "feasibilityScore": 0,
  "feasibilityFeedback": "可行性评估：数据可得性、算力/时间成本、技术成熟度",
  "methods": ["推荐的方法或实验设计 1", "推荐的方法或实验设计 2"],
  "risks": ["主要风险 1", "主要风险 2"],
  "nextSteps": ["下一步具体行动 1", "下一步具体行动 2"]
}
评分 0-100。noveltyFeedback / feasibilityFeedback 用中文分点说明，每个 2-4 句话。methods / risks / nextSteps 各 2-4 条，每条一句话。`;

/** 多文献对比：并排对比多篇论文的研究问题/方法/结论/局限 */
export const PAPER_COMPARISON = (papers: string) => `
你是科研综述助手。请对以下多篇论文做横向对比分析，提炼出可用于综述写作的对比表。

论文列表（标题 | 年份 | 期刊/来源 | 方法 | 结论）：
${papers}

请只输出一个合法的纯 JSON 对象（禁止任何 markdown 代码围栏或前后缀文字，不要反引号）；JSON 字符串内的换行必须使用 \\n 转义，禁止字面换行。JSON 结构：
{
  "summary": "一段 2-4 句的横向总评：这些工作的共同主线、关键分歧、研究空白",
  "rows": [
    { "paper": "论文 1 标题（年份）", "研究问题": "一句话", "方法": "一句话", "主要结论": "一句话", "局限": "一句话" },
    { "paper": "论文 2 标题（年份）", "研究问题": "一句话", "方法": "一句话", "主要结论": "一句话", "局限": "一句话" }
  ]
}
rows 与输入的论文一一对应（按输入顺序），每格一句话、中文、不超过 60 字。`;

/** 多角色模拟同行评审：3 位审稿人不同视角 + 综合录用建议 */
export const SIMULATED_REVIEW = (title: string, content: string) => `
你是期刊编辑部组织的三位同行评审专家，分别从不同视角评审同一篇论文稿件，最后由主编给出综合决定。

论文标题：${title}
论文正文：
${content}

请只输出一个合法的纯 JSON 对象（禁止任何 markdown 代码围栏或前后缀文字，不要反引号）；JSON 字符串内的换行必须使用 \\n 转义，禁止字面换行。JSON 结构：
{
  "reviewers": [
    {
      "role": "新颖性审稿人",
      "score": 0,
      "strengths": ["优点 1", "优点 2"],
      "concerns": ["主要问题 1", "主要问题 2"],
      "suggestion": "对该稿件的具体修改建议"
    },
    {
      "role": "方法严谨性审稿人",
      "score": 0,
      "strengths": ["优点 1", "优点 2"],
      "concerns": ["主要问题 1", "主要问题 2"],
      "suggestion": "对该稿件的具体修改建议"
    },
    {
      "role": "表达与规范审稿人",
      "score": 0,
      "strengths": ["优点 1", "优点 2"],
      "concerns": ["主要问题 1", "主要问题 2"],
      "suggestion": "对该稿件的具体修改建议"
    }
  ],
  "verdict": "录用建议（四选一）：录用 / 小修 / 大修 / 拒稿",
  "overall": "主编综合意见：一段话说明决定理由与最关键改进点"
}
每位审稿人 score 0-100，strengths/concerns 各 2-3 条，suggestion 2-3 句话。`;

/* ================= 科研专门加强（Phase 6） ================= */

/** 论文摘要 + 关键词生成（科研头部要素） */
export const GENERATE_ABSTRACT = (title: string, content: string) => `
你是一位资深论文编辑。请根据论文标题与正文，生成符合学术规范的摘要与关键词。

论文标题：${title}
正文节选：
${(content || '').slice(0, 3000)}

只允许输出一个 JSON 对象，不要输出任何其他文字：
{
  "abstract": "150-200字中文摘要：背景一句话 → 问题 → 方法 → 结果 → 结论，逻辑完整",
  "keywords": ["3-6个学术关键词，中文，用顿号风格"]
}
要求：摘要必须严格基于正文内容，不得编造数据或结论；用词学术化，不用"我们""本文尝试"等口语。`;

/** 单篇文献深度精读（Consensus/Lateral 式科研论文解剖） */
export const DEEP_DIVE_PAPER = (paper: string) => `
你是一位科研论文精读助手。请对下面这篇文献做结构化深度解读。

文献信息：
${paper}

只允许输出一个 JSON 对象，不要输出任何其他文字：
{
  "title": "论文标题",
  "oneLine": "一句话概括这篇论文做了什么（30字内）",
  "researchQuestion": "研究问题：作者试图回答什么问题",
  "motivation": "研究动机：为什么这个问题重要",
  "method": "方法：数据集、模型/实验设计、评估指标",
  "keyFindings": ["关键发现 1", "关键发现 2", "关键发现 3"],
  "limitations": ["局限 1", "局限 2"],
  "futureWork": "作者/领域后续可做的工作",
  "takeaway": "对读者的核心启示（一段话）"
}
要求：严格基于给出的文献信息，不得编造；每个字段用中文；keyFindings 2-4 条，limitations 1-3 条。`;

/** 研究缺口定位（科研选题：识别未被充分研究的子问题） */
export const RESEARCH_GAP = (topic: string, papers: string) => `
你是一位科研选题顾问。请基于文献库判断该研究主题下"尚未被充分研究"的方向（Research Gap）。

研究主题：${topic}
文献库：
${papers}

只允许输出一个 JSON 对象，不要输出任何其他文字：
{
  "gaps": [
    {
      "gap": "具体的研究缺口描述（要具体到方法/场景/数据类型层面，不能是泛泛的'需要更多研究'）",
      "evidence": "基于文献库哪几篇（[Ref:N]）看出这个缺口，为什么",
      "opportunity": "填补该缺口的可行切入点与预期贡献",
      "feasibility": "可行性判断：数据可得性/方法成熟度/周期（高/中/低）"
    }
  ],
  "recommendedTopic": "综合给出的一个可操作的论文选题建议（含限定词，如'基于XX的XX在XX场景下的研究'）"
}
要求：gaps 给 2-4 条；每条必须绑定到文献库中的真实文献；禁止编造不存在的文献；中文输出。`;

export const GENERATE_FIGURES = (topic: string, outline: string, contentHead: string) => `
你是一位学术论文图表设计专家。请为下面的综述论文生成 2-3 个高质量的学术图表（mermaid 格式），用于提升论文可视化质量。

论文主题：${topic}
论文大纲：${outline}
正文开头（供参考风格）：${contentHead.slice(0, 1200)}

输出要求（严格 JSON，无围栏无前缀文字，字符串内换行用 \n 转义）：
{
  "figures": [
    {
      "figureType": "flowchart | graph | sequenceDiagram | erDiagram",
      "title": "图 N：简短标题",
      "caption": "图表说明（一句话解释读者如何理解该图）",
      "mermaid": "mermaid 代码（只包含图定义部分，不含图题；节点文字用中文，结构清晰）"
    }
  ]
}
图表主题建议（按论文实际领域选择与适配，禁止照搬示例措辞）：① 研究脉络/技术演进路线（按时间或范式分阶段，flowchart 纵向布局）；② 方法/方案分类对比（不同流派或体系对比，graph 或 erDiagram）；③ 本文综述框架总览（论述结构或研究流程，flowchart）。
要求：mermaid 语法必须正确、可被 mermaid 解析器渲染；不要使用特殊字符破坏语法；主题必须贴合论文自身领域与内容，不得引入论文未涉及的领域概念；每个图至少 5 个节点。`;
