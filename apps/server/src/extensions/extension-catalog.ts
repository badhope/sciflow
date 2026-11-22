/**
 * 内置扩展目录（v1.4）。
 *
 * 两类：
 *  - public：真实开源社区资产（GitHub 仓库 + 许可证 + 星标量级 + 安装方式），随仓库发布、默认启用；
 *  - private：SciFlow 自研科研增强（不导出、不出现在对外 MCP 清单，仅本机用户可用）。
 *
 * 说明：这里只收录「可核对」的仓库信息（名称/描述/许可证/入口），不复制第三方源码；
 * 纯提示词/角色类资产由本项目自行撰写（不涉及第三方版权）。
 */

export type ExtensionKind = 'skill' | 'mcp' | 'role' | 'constraint' | 'hook' | 'prompt';

export const EXTENSION_KINDS: { value: ExtensionKind; label: string; description: string }[] = [
  { value: 'skill', label: '技能 Skills', description: '注入对话上下文的科研能力说明（可裁剪工具暴露面）' },
  { value: 'mcp', label: 'MCP 服务器', description: '外部工具协议端点（HTTP Streamable，可连接后调用）' },
  { value: 'role', label: '角色 Roles', description: '系统提示词角色（审稿人/方法学家/统计顾问…）' },
  { value: 'constraint', label: '约束 Constraints', description: '每次 AI 调用注入的硬性规则' },
  { value: 'hook', label: '钩子 Hooks', description: '生命周期钩子（注入/拦截/webhook）' },
  { value: 'prompt', label: '提示词模板 Prompts', description: '覆盖具体科研工具的默认提示词' },
];

export interface BuiltinAsset {
  key: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  source: 'builtin-public' | 'builtin-private';
  repo?: string;
  license?: string;
  install?: string;
  tags: string[];
  manifest: Record<string, unknown>;
  /** 仅为远程 HTTP 端点时提供，启用后投影为 mcp_server 行 */
  url?: string;
  /** 需要用户先在本机安装/启动的服务，默认不启用，避免“看起来已连接、调用必失败” */
  defaultEnabled?: boolean;
}

/** 社区 MCP：远程免安装端点优先（已实测），本地 stdio 项目明确标注“需安装” */
const MCP_ASSETS: BuiltinAsset[] = [
  {
    key: 'mcp-context7', kind: 'mcp', source: 'builtin-public', name: 'Context7（库文档检索）',
    description: '按库名/版本实时取官方文档片段，写代码或核对 API 时避免凭记忆编造。远程 HTTP 端点，2026-11-21 实测可连。',
    repo: 'upstash/context7', license: 'MIT', url: 'https://mcp.context7.com/mcp',
    install: '远程 HTTP：https://mcp.context7.com/mcp', tags: ['docs', 'remote'],
    manifest: { transport: 'http', url: 'https://mcp.context7.com/mcp', tools: ['resolve-library-id', 'query-docs'] },
  },
  {
    key: 'mcp-deepwiki', kind: 'mcp', source: 'builtin-public', name: 'DeepWiki（仓库知识库）',
    description: '把任意 GitHub 仓库转成可问答的工程知识库，适合读开源实现细节。2026-11-21 实测可连，3 个工具。',
    repo: 'regenrek/deepwiki-mcp', license: 'MIT', url: 'https://mcp.deepwiki.com/mcp',
    install: '远程 HTTP：https://mcp.deepwiki.com/mcp', tags: ['repo', 'remote'],
    manifest: { transport: 'http', url: 'https://mcp.deepwiki.com/mcp', tools: ['ask_wiki_question', 'read_wiki_contents', 'read_wiki_structure'] },
  },
  {
    key: 'mcp-huggingface', kind: 'mcp', source: 'builtin-public', name: 'Hugging Face（模型与数据集检索）',
    description: '官方远程 MCP：检索模型、数据集与仓库详情。适合找可复现的模型/数据资产。2026-11-21 实测可连，4 个工具。',
    url: 'https://huggingface.co/mcp',
    install: '远程 HTTP：https://huggingface.co/mcp', tags: ['models', 'datasets', 'remote'],
    manifest: { transport: 'http', url: 'https://huggingface.co/mcp', tools: ['hf_whoami', 'hub_repo_search', 'hub_repo_details', 'hf_fs'] },
  },
  {
    key: 'mcp-mslearn', kind: 'mcp', source: 'builtin-public', name: 'Microsoft Learn（官方技术文档）',
    description: '微软官方远程 MCP：搜索文档、代码样例并抓取全文，写代码/配环境时对照官方说明。2026-11-21 实测可连，3 个工具。',
    url: 'https://learn.microsoft.com/api/mcp',
    install: '远程 HTTP：https://learn.microsoft.com/api/mcp', tags: ['docs', 'code', 'remote'],
    manifest: { transport: 'http', url: 'https://learn.microsoft.com/api/mcp', tools: ['microsoft_docs_search', 'microsoft_code_sample_search', 'microsoft_docs_fetch'] },
  },
  {
    key: 'mcp-openalex', kind: 'mcp', source: 'builtin-public', name: 'OpenAlex（全球学术图谱）',
    description: '270M+ 学术作品的检索、作者/机构/主题、引用网络与趋势聚合。公共托管 Streamable HTTP，2026-11-22 实测可连；非官方托管，匿名有每日预算与限流。',
    repo: 'cyanheads/openalex-mcp-server', license: 'Apache-2.0', url: 'https://openalex.caseyjhand.com/mcp',
    install: '远程 HTTP：https://openalex.caseyjhand.com/mcp（也可按仓库自建 stdio/HTTP）', tags: ['literature', 'citation', 'trends', 'remote'],
    manifest: { transport: 'http', url: 'https://openalex.caseyjhand.com/mcp', tools: ['openalex_resolve_name', 'openalex_search_entities', 'openalex_analyze_trends', 'openalex_get_citation_graph', 'openalex_describe_fields'] },
  },
  {
    key: 'mcp-crossref-remote', kind: 'mcp', source: 'builtin-public', name: 'Crossref（DOI 与出版元数据）',
    description: '检索 188M+ 作品、按 DOI 取出版元数据与参考文献、查期刊/资助方。公共托管 Streamable HTTP，2026-11-22 实测可连，无需 Key。',
    repo: 'cyanheads/crossref-mcp-server', license: 'Apache-2.0', url: 'https://crossref.caseyjhand.com/mcp',
    install: '远程 HTTP：https://crossref.caseyjhand.com/mcp（也可按仓库自建）', tags: ['literature', 'doi', 'metadata', 'remote'],
    manifest: { transport: 'http', url: 'https://crossref.caseyjhand.com/mcp', tools: ['crossref_search_works', 'crossref_get_work', 'crossref_get_references', 'crossref_search_journals', 'crossref_search_funders', 'crossref_get_member', 'crossref_get_prefix'] },
  },
  {
    key: 'mcp-pubmed-remote', kind: 'mcp', source: 'builtin-public', name: 'PubMed / Europe PMC（生物医学）',
    description: 'PubMed 与 Europe PMC 检索、全文、引用、MeSH、相关文献与引用指标。公共托管 Streamable HTTP，2026-11-22 实测可连，无需 Key；医学用户再启用。',
    repo: 'cyanheads/pubmed-mcp-server', license: 'Apache-2.0', url: 'https://pubmed.caseyjhand.com/mcp',
    defaultEnabled: false,
    install: '远程 HTTP：https://pubmed.caseyjhand.com/mcp（也可按仓库自建）', tags: ['biomedical', 'pubmed', 'mesh', 'remote'],
    manifest: { transport: 'http', url: 'https://pubmed.caseyjhand.com/mcp', tools: ['pubmed_search_articles', 'pubmed_fetch_articles', 'pubmed_fetch_fulltext', 'pubmed_format_citations', 'pubmed_find_related', 'pubmed_spell_check', 'pubmed_lookup_mesh', 'pubmed_lookup_citation', 'pubmed_convert_ids', 'pubmed_fetch_citation_metrics', 'pubmed_europepmc_search', 'pubmed_europepmc_fetch'] },
  },
  {
    key: 'mcp-arxiv', kind: 'mcp', source: 'builtin-public', name: 'arXiv（预印本检索与全文）',
    description: '检索 arXiv、按 ID 取元数据、读 HTML/PDF 全文、列分类。公共托管 Streamable HTTP，2026-11-22 实测可连，无需 Key；非官方托管，失效可按仓库自建。',
    repo: 'cyanheads/arxiv-mcp-server', license: 'Apache-2.0', url: 'https://arxiv.caseyjhand.com/mcp',
    install: '远程 HTTP：https://arxiv.caseyjhand.com/mcp（也可 npx @cyanheads/arxiv-mcp-server 自建）', tags: ['literature', 'arxiv', 'fulltext', 'remote'],
    manifest: { transport: 'http', url: 'https://arxiv.caseyjhand.com/mcp', tools: ['arxiv_search_papers', 'arxiv_get_metadata', 'arxiv_read_paper', 'arxiv_list_categories'] },
  },
  {
    key: 'mcp-paper-search', kind: 'mcp', source: 'builtin-public', name: 'Paper Search MCP（多库学术搜索）',
    description: '跨 arXiv/PubMed/Google Scholar 等检索并下载论文，附带 CLI 与 Skills。约 2.9k star。',
    repo: 'openags/paper-search-mcp', license: 'MIT',
    install: 'pip install paper-search-mcp（stdio）', tags: ['literature', 'pubmed'],
    manifest: { transport: 'stdio', command: 'uvx paper-search-mcp', tools: ['search_papers', 'download_paper'] },
  },
  {
    key: 'mcp-zotero', kind: 'mcp', source: 'builtin-public', name: 'Zotero MCP（文献库直连）',
    description: '把 Zotero 文献库接入对话：检索条目、读笔记、取附件全文。约 5.6k star。',
    repo: '54yyyu/zotero-mcp', license: 'MIT',
    install: 'pip install zotero-mcp（需 Zotero 本地 API 或 Web API Key）', tags: ['zotero', 'literature'],
    manifest: { transport: 'stdio', command: 'uvx zotero-mcp', tools: ['search_items', 'get_item_notes', 'get_item_fulltext'] },
  },
  {
    key: 'mcp-biomcp', kind: 'mcp', source: 'builtin-public', name: 'BioMCP（生物医学检索）',
    description: 'PubMed / ClinicalTrials / 变异注释等生物医学数据统一检索，适合医学与生命科学。',
    repo: 'genomoncology/biomcp', license: 'MIT',
    install: 'pip install biomcp（stdio）', tags: ['biomedical', 'pubmed'],
    manifest: { transport: 'stdio', command: 'uvx biomcp', tools: ['pubmed_search', 'trial_search'] },
  },
  {
    key: 'mcp-semantic-scholar', kind: 'mcp', source: 'builtin-public', name: 'Semantic Scholar MCP',
    description: 'Semantic Scholar 论文检索、引用网络与 TLDR 摘要。',
    repo: 'zongmin-yu/semantic-scholar-fastmcp-mcp-server', license: 'MIT',
    install: 'pip install semantic-scholar-fastmcp（stdio）', tags: ['literature', 'citation'],
    manifest: { transport: 'stdio', tools: ['search_papers', 'paper_details', 'citations'] },
  },
  {
    key: 'mcp-cnki', kind: 'mcp', source: 'builtin-public', name: 'CNKI MCP（知网检索）',
    description: '中国知网文献/期刊检索的 MCP + CLI + Skills（需合法机构访问权限）。',
    repo: 'SepineTam/cnki-mcp', license: 'MIT',
    install: 'pip install cnki-mcp（stdio；需机构订阅）', tags: ['cnki', 'chinese'],
    manifest: { transport: 'stdio', tools: ['search_literature', 'search_journal'] },
  },
  {
    key: 'mcp-obsidian', kind: 'mcp', source: 'builtin-public', name: 'Obsidian MCP（笔记库）',
    description: '通过 Obsidian Local REST API 读写笔记，把研究笔记库接入对话。约 4.5k star。',
    repo: 'MarkusPfundstein/mcp-obsidian', license: 'MIT',
    install: 'uvx mcp-obsidian（需 Obsidian Local REST API 插件）', tags: ['notes', 'obsidian'],
    manifest: { transport: 'stdio', tools: ['list_files', 'get_file_contents', 'search'] },
  },
  {
    key: 'mcp-notebooklm', kind: 'mcp', source: 'builtin-public', name: 'NotebookLM MCP',
    description: '把 NotebookLM 笔记本作为可查询知识源接入（浏览器自动化后端）。约 3.4k star。',
    repo: 'PleasePrompto/notebooklm-mcp', license: 'MIT',
    install: 'npx -y notebooklm-mcp（stdio；需登录态）', tags: ['notebook', 'knowledge'],
    manifest: { transport: 'stdio', tools: ['list_notebooks', 'ask_notebook'] },
  },
  {
    key: 'mcp-basic-memory', kind: 'mcp', source: 'builtin-public', name: 'Basic Memory（长期记忆）',
    description: '基于 Markdown 的持久记忆层，让对话跨会话记住项目事实。约 4.4k star。',
    repo: 'basicmachines-co/basic-memory', license: 'AGPL-3.0',
    install: 'uvx basic-memory mcp（stdio）', tags: ['memory', 'notes'],
    manifest: { transport: 'stdio', tools: ['write_note', 'search_notes', 'recent_activity'] },
  },
  {
    key: 'mcp-deep-research', kind: 'mcp', source: 'builtin-public', name: 'Deep Research（多 LLM 深研）',
    description: '开源 deep research 引擎，支持 SSE API 与 MCP 接入，多轮检索生成报告。约 4.7k star。',
    repo: 'u14app/deep-research', license: 'MIT',
    install: 'docker run -p 3000:3000 u14app/deep-research（HTTP 端点）', tags: ['deep-research', 'report'],
    defaultEnabled: false,
    manifest: { transport: 'http', url: 'http://localhost:3000/mcp', tools: ['deep_research'] },
  },
  {
    key: 'mcp-agentset', kind: 'mcp', source: 'builtin-public', name: 'Agentset（RAG 平台）',
    description: '开源 RAG 平台，内置引用与 deep research，支持 22+ 文件格式。约 2.1k star。',
    repo: 'agentset-ai/agentset', license: 'MIT',
    install: 'docker compose up（自托管 HTTP）', tags: ['rag', 'citations'],
    defaultEnabled: false,
    manifest: { transport: 'http', url: 'http://localhost:3001/mcp' },
  },
  {
    key: 'mcp-docsagent', kind: 'mcp', source: 'builtin-public', name: 'DocsAgent（私有文档问答）',
    description: '给 agent 提供个人知识库的私有访问，支持增量索引。',
    repo: 'docsagent/docsagent', license: 'MIT',
    install: 'docker run docsagent（HTTP）', tags: ['docs', 'knowledge'],
    defaultEnabled: false,
    manifest: { transport: 'http', url: 'http://localhost:8080/mcp' },
  },
  {
    key: 'mcp-paperdebugger', kind: 'mcp', source: 'builtin-public', name: 'PaperDebugger（编辑器内写作/评审）',
    description: '插件式多智能体系统，在编辑器内做学术写作、评审与改进建议。约 1.5k star。',
    repo: 'PaperDebugger/paperdebugger', license: 'Apache-2.0',
    install: '见仓库 README（Obsidian/VS Code 插件）', tags: ['writing', 'review'],
    manifest: { transport: 'stdio', tools: ['review_section', 'suggest_improvements'] },
  },
  {
    key: 'mcp-pdfmathtranslate', kind: 'mcp', source: 'builtin-public', name: 'PDFMathTranslate（PDF 翻译保排版）',
    description: '翻译科学 PDF 并保留公式与版式，EMNLP 2025 Demo。约 37.9k star。',
    repo: 'PDFMathTranslate/PDFMathTranslate', license: 'AGPL-3.0',
    install: 'pip install pdf2zh 或 docker run（CLI/HTTP）', tags: ['pdf', 'translate'],
    manifest: { transport: 'stdio', command: 'pdf2zh-mcp' },
  },
  {
    key: 'mcp-lit-review-tools', kind: 'mcp', source: 'builtin-public', name: 'Lit Review Agent Tools（综述工具索引）',
    description: '面向文献综述的 AI-agent 工具精选清单（可据此挑选并导入具体 MCP）。',
    repo: 'brycewang-stanford/lit-review-agent-tools', license: 'MIT',
    install: 'git clone https://github.com/brycewang-stanford/lit-review-agent-tools', tags: ['catalog', 'literature'],
    manifest: { transport: 'reference' },
  },
  {
    key: 'mcp-patent', kind: 'mcp', source: 'builtin-public', name: 'Patsnap MCP（专利与科学文献）',
    description: '覆盖 2 亿+ 专利与科学文献、化学与制药数据的 MCP（需 Patsnap 账号）。',
    repo: 'patsnap/mcp', license: 'Proprietary',
    install: '见仓库 README（远程/本地可选）', tags: ['patent', 'literature'],
    manifest: { transport: 'http' },
  },
  {
    key: 'mcp-llm-for-zotero', kind: 'mcp', source: 'builtin-public', name: 'LLM for Zotero（文献库研究代理）',
    description: '面向 Zotero 库的开源研究代理系统：整库问答、跨文献综合。约 3.4k star。',
    repo: 'yilewang/llm-for-zotero', license: 'MIT',
    install: 'git clone https://github.com/yilewang/llm-for-zotero', tags: ['zotero', 'agent'],
    manifest: { transport: 'stdio' },
  },
];
/** 社区 Skills（正文由本项目重写，保留公开来源作参考；启用即注入，不再只是仓库链接） */
function skillAsset(
  key: string,
  name: string,
  description: string,
  instructions: string,
  tags: string[],
  provenance?: { repo: string; license: string; install: string },
): BuiltinAsset {
  return {
    key, kind: 'skill', source: 'builtin-public', name, description, tags,
    ...(provenance ? provenance : {}),
    manifest: { mode: 'prompt', instructions },
  };
}

const SKILL_ASSETS: BuiltinAsset[] = [
  skillAsset(
    'skill-anthropic-official', '文档与表格交付规范',
    'Word / Excel / PDF / PPT 的真实文件交付流程与自检清单（参考 anthropics/skills 的公开做法，正文为 SciFlow 重写）。',
    '交付 Office 文件时先确认格式、模板、纸张与字体，再生成内容。Word 必须是真实 .docx：标题用样式、目录可更新、页码齐全、图片不拉伸；Excel 公式必须可重算，不写死结果，并另存数值副本；PDF 保留可检索文本与嵌入字体；PPT 一页一个论点，图表带标题、单位与来源。交付前逐项自检：打开无乱码、无 #REF!、目录可更新、文件能被非本机软件打开。禁止把 Markdown 改扩展名冒充 Office 文件。',
    ['docs', 'office'],
    { repo: 'anthropics/skills', license: 'Apache-2.0', install: '参考实现，无需安装' },
  ),
  skillAsset(
    'skill-academic-research', '科研全流程总控',
    '从问题界定到投稿的 8 阶段流程，每阶段强制产出可检查的中间物。',
    '把任务拆成：问题界定→检索→证据表→方法设计→数据/实验→写作→评审→投稿。每阶段先产出可检查的中间物（检索式、证据表、分析计划、提纲），再进入下一阶段。开始前读取项目 Research Brief 与已有文档，避免重复劳动。遇到缺失数据或无法完成的实验，明确列为缺口，不编造。每轮结束给：已完成、待确认、下一步。需要事实时先调用检索/知识库工具，不凭记忆回答。',
    ['workflow', 'academic'],
  ),
  skillAsset(
    'skill-codex-academic', '文献精读与笔记',
    '三遍法精读论文，输出 12 维固定矩阵，区分作者结论与自己的推断。',
    '精读按三遍法：①标题/摘要/结论，判断是否相关；②图表与方法，提取研究设计、样本、基线、指标；③复现细节与局限，核对假设、统计前提、消融。输出固定矩阵：问题、假设、数据、方法、基线、指标、主结果、消融、局限、可复现性、可引用点、可借鉴点。缺失写「未报告」。引用要给页码或章节。不要把作者结论写成自己的推断，也不要把摘要没写的内容猜成全文事实。',
    ['reading', 'notes'],
  ),
  skillAsset(
    'skill-agent-research', '系统综述与 PRISMA',
    '可复现的系统综述协议、检索式、双轮筛选与 PRISMA 数量报告。',
    '系统综述必须可复现：先写协议（PICO 问题、数据库、检索式、时间范围、语言、纳入排除标准）；检索式记录到可重跑；筛选做标题/摘要与全文两轮，逐条记录排除原因；用 PRISMA 流程图报告识别、去重、筛选、纳入数量；数据抽取双人核对；偏倚风险用对应工具（RCT 用 RoB2，观察性用 NOS）。没有检索记录与筛选日志，就不能宣称「系统综述」。',
    ['systematic-review', 'prisma'],
  ),
  skillAsset(
    'skill-claude-scholar', '研究选题与假设',
    '用现象缺口、理论缺口、方法缺口三层定位题目，并写成可证伪假设。',
    '选题从「现象缺口→理论缺口→方法缺口」三层定位。每个候选题目给出：一句话问题、为什么现在重要、已有工作做到了哪、你准备改变什么、最小可验证实验、失败会说明什么。假设必须可证伪，写清自变量、因变量、控制变量与预期方向。避免「首次」「颠覆」这类无法验证的表述；新颖性必须用检索证据支撑，而不是自我评价。',
    ['ideation', 'hypothesis'],
  ),
  skillAsset(
    'skill-humanizer', '中文学术去 AI 腔',
    '删除模板开头、排比句与空泛评价，保留作者原意、数据与引用。',
    '改写中文学术文本时：删「首先/其次/最后」「综上所述」「随着…的发展」等模板开头；拆长排比句，允许长短句交错；把「具有重要意义」换成具体机制或效果；减少「不仅…而且」「一方面…另一方面」的对偶；每段只推进一个论点；保留作者原有用词与限定强度。输出只给改写文，另附 3 条主要改动理由，不改数据与引用，不把限定词改成绝对判断。',
    ['writing', 'style'],
  ),
  skillAsset(
    'skill-claude-prism', 'LaTeX 与引用工作流',
    '从文档类、编译引擎到参考文献与图表标签的可复现 LaTeX 流程。',
    '处理 LaTeX 稿件：先确认文档类、编译引擎（pdfLaTeX/XeLaTeX/LuaLaTeX）、参考文献工具（biber/bibtex）与模板要求；中文用 ctex 或 xeCJK。引用键统一为「作者年份关键词」，正文用 \cite{}，不要手写编号。图表用 \label/\ref，公式用 \eqref。编译后检查 overfull box、未定义引用、重复标签、缺失图片。给出可复现的编译命令链与所需宏包清单。',
    ['latex', 'citation'],
  ),
  skillAsset(
    'skill-latte-review', '文献筛选与数据抽取',
    '批量筛选表与固定抽取字段，保留原文位置，拿不到全文就标注。',
    '批量筛选文献时输出表：ID、标题、年份、来源、与问题的相关性（高/中/低/排除）、排除理由、待抽取字段。抽取字段固定为：研究设计、样本与场景、干预/暴露、对照、主要结局、效应量与置信区间、局限。每条记录保留原文位置（页码/章节）。不要因为摘要没写就猜全文；拿不到全文标「仅摘要」。抽取结果要能回到原文核对。',
    ['screening', 'extraction'],
  ),
  skillAsset(
    'skill-paper-proofreading', '论文校对',
    '事实与引用、结构、语言、格式四轮校对，输出可定位的问题清单。',
    '校对分四轮：①事实与引用：每个 [n] 有对应条目，DOI/年份/作者一致；②结构：摘要含目的/方法/结果/结论，正文无孤立段落；③语言：主谓一致、时态统一、术语一致、冠词与介词；④格式：单位空格、数字精度、图表编号、基金号。输出问题清单（位置/原文/建议/严重度），不要直接重写全文；无法确认的事实标「需作者核实」。',
    ['proofreading', 'quality'],
  ),
  skillAsset(
    'skill-ai-research-writing', '学术写作论证',
    '主张、证据、解释、边界四段式推进，区分事实、推断与建议。',
    '学术写作按「主张→证据→解释→边界」推进：每段开头一句可反驳的主张，中间给数据或文献证据，随后解释机制，最后写适用条件与反例。区分事实、推断与建议。使用审慎动词（suggest/indicate/associated with），只有研究设计支持时才使用因果表述。避免形容词堆砌。每节结尾写一句「本节结论」，并与摘要保持一致。',
    ['writing', 'argument'],
  ),
  skillAsset(
    'skill-deep-research-prompts', '深度调研',
    '先拆子问题，再按来源等级取证，输出证据表、反方证据与未解问题。',
    '深度调研先列 8-12 个待答子问题，按「定义→现状→机制→证据→争议→空白」排序。每个子问题至少两个独立来源，优先原始论文、官方文档与数据集，其次综述，最后新闻。给出来源等级与冲突点。输出：结论摘要（带置信度）、证据表、反方证据、未解问题、可执行下一步。找不到证据就写「未检索到」，不要用常识补，也不要把同一来源的转载当成两个独立证据。',
    ['deep-research', 'evidence'],
  ),
  skillAsset(
    'skill-webfuse-autoresearch', '自主研究循环',
    '计划、执行、评估、决定四步循环，最多五轮，中间结论必须落盘。',
    '自主研究每一轮固定四步：计划（本轮要回答什么、用什么工具、成功标准）→执行（记录每次调用与结果）→评估（证据是否足够、是否出现矛盾）→决定（继续/换方法/停止）。最多连续 5 轮，超过则总结进展并请求用户确认。所有中间结论落到文件或证据表，禁止只在对话里滚动。每轮结束写明「本轮新增证据 / 仍缺什么 / 下一轮计划」。',
    ['autoresearch', 'loop'],
  ),
  skillAsset(
    'skill-scientific-agent-skills', '数据分析与统计报告',
    '数据字典、预注册分析计划、效应量与置信区间、图表与随机种子。',
    '拿到数据先做数据字典：字段、类型、单位、缺失率、取值范围、采集方式。分析前写假设与主/次结局，避免事后挑指标。描述统计给 n、均值或中位数、SD 或 IQR；推断统计报效应量、置信区间、检验方法与前提检查。多重比较要校正。图表给原始点或分布，不只给均值柱。代码固定随机种子并保存环境与版本。',
    ['statistics', 'data'],
  ),
  skillAsset(
    'skill-flonat-research', '博士研究基建',
    '研究日志、文献库、实验登记、决策记录四份长期文件与每周复盘。',
    '长期研究项目维护四份文件：研究日志（日期/假设/动作/结果）、文献库（含 DOI 与笔记）、实验登记（配置/种子/指标/产物路径）、决策记录（为什么选 A 不选 B）。每周复盘：进展、阻塞、下周最小目标。跨月任务先写里程碑与验收标准。任何结果先落盘再汇报，避免会话丢失。交接时附上这四份文件与未完成事项，不靠口头记忆。',
    ['phd', 'infrastructure'],
  ),
  skillAsset(
    'skill-paper-craft', '顶会论文规则',
    '摘要四句、引言一页、贡献不超过三条，每条贡献都有实验支撑。',
    '顶会投稿先对齐模板与页数限制。摘要用「问题-方法-结果-意义」四句；引言在一页内说清 gap 与贡献；方法写可复现细节；实验给基线、消融与失败案例；结论不夸大。贡献列表不超过 3 条，每条都要有实验或理论支撑。检查匿名化、附录引用、图表可读性与参考文献格式。审稿回复只回应可核查的事实，不堆形容词。',
    ['writing', 'conference'],
  ),
  skillAsset(
    'skill-agent-loop', '迭代自评',
    '逻辑、证据、表达三轮自检，每轮给出问题、位置、修改与复检结果。',
    '完成初稿后做三轮自评：①逻辑：每节是否回答研究问题，是否存在跳跃；②证据：每个事实是否有来源，引用是否支持原句；③表达：是否有重复、歧义、未定义缩写。每轮列出「问题→位置→修改→复检结果」，直到无高危问题。不要用「已优化」代替具体修改，也不要把「模型觉得没问题」当作通过标准。',
    ['review', 'loop'],
  ),
  skillAsset(
    'skill-openalex-citation-chase', '文献发现与引用追踪',
    '把主题拆成英文检索式，跨 OpenAlex / Crossref / arXiv 取证，并用引用网络做前向与后向追踪。',
    '做文献发现时先把主题拆成 2-4 组英文检索式（概念词、同义词、方法词），用 literature.discover 或 OpenAlex / Crossref / arXiv 检索；结果按 DOI 去重，保留 OpenAlex ID、DOI、年份、来源。相关性先看标题与摘要是否真的回答研究问题，不按引用数排序。对核心论文做引用追踪：后向读参考文献找奠基工作，前向读施引文献找最新进展；把候选分为核心证据、背景、方法参考、需排除四类，并记录排除理由。中文主题必须补英文检索词；找不到全文标「仅摘要」，不得据标题编造结论。',
    ['literature', 'openalex', 'citation', 'search'],
  ),
  skillAsset(
    'skill-research-trends', '研究趋势计量',
    '用 OpenAlex 聚合做年份、国家、机构与主题趋势，区分存量、增量与质量，不把发文量当影响力。',
    '做领域趋势分析时先固定检索式、时间窗、文献类型与数据源，再按年、国家/地区、机构、主题、期刊分组计数。报告每个分组的总量与占比，区分存量与年度新增；发文量只说明活跃度，不等于质量或影响力，引用指标要说明口径与窗口。对突然增长的主题检查是否由会议/特刊/数据库收录策略造成。输出可复现的检索式、数据快照日期、主要图表与三条局限；不得用单年峰值预测长期趋势。',
    ['trends', 'openalex', 'bibliometrics'],
  ),
];
/** 本项目撰写的角色（无第三方版权） */
function roleAsset(key: string, name: string, prompt: string, description: string, tags: string[] = []): BuiltinAsset {
  return {
    key: `role-${key}`, kind: 'role', source: 'builtin-public', name, description,
    tags: ['role', ...tags], manifest: { systemPrompt: prompt },
  };
}

const ROLE_ASSETS: BuiltinAsset[] = [
  roleAsset('methodologist', '方法学家', '你是研究方法专家。评审或设计研究时，必须逐项检查：研究问题与方法的匹配度、变量操作化、抽样与偏倚、对照设置、混杂控制、功效与样本量、统计方法前提、可复现性。每条意见给出严重度与可执行修改建议。', '从方法学角度审查研究设计，覆盖偏倚、对照与统计前提'),
  roleAsset('statistician', '统计顾问', '你是统计顾问。所有数值结论必须给出统计口径（均值/中位数、置信区间、样本量、检验方法与前提）。不得假设数据分布；前提不满足时明确说明并给替代方案。', '统计口径与检验选择顾问，拒绝无口径数字'),
  roleAsset('journal-editor', '期刊编辑', '你是顶刊编辑。评估稿件时按：契合度（scope）、新颖性、方法严谨性、证据强度、写作清晰度、伦理合规逐项打分并给结论（送审/退修/拒稿）。指出桌面拒稿风险。', '以编辑视角做桌面评估与送审建议'),
  roleAsset('grant-reviewer', '基金评审专家', '你是基金评审专家。按「重要性、创新性、可行性、团队能力、预算合理性、风险预案」评审申请书，给出评分与逐条改进建议；指出评审人最可能质疑的三点。', '基金申请书评审与风险预判'),
  roleAsset('data-steward', '数据管理员', '你是数据管理员。检查数据可用性声明、元数据完整性、单位与编码一致性、隐私与脱敏、FAIR 原则落实情况，并给出可执行的补救清单。', 'FAIR 与数据可用性审查'),
  roleAsset('ethics-reviewer', '伦理审查员', '你是伦理审查员。检查人体/动物研究伦理审批、知情同意、隐私保护、利益冲突、AI 使用声明与生成内容披露，不符合项必须显式列出。', '伦理与合规审查（含 AI 使用声明）'),
  roleAsset('librarian', '科研馆员', '你是科研馆员。负责检索策略设计：数据库选择、检索式（布尔/字段限定）、同义词与受控词表、去重与筛选流程（PRISMA），并输出可复现的检索记录。', '检索策略与 PRISMA 流程设计'),
  roleAsset('repro-officer', '可复现性专员', '你是可复现性专员。逐项核对代码、数据、环境、随机种子、超参数、评估脚本与硬件说明；输出可复现性清单与缺口。', '复现清单与环境/种子核查'),
  roleAsset('figure-designer', '学术图表设计师', '你是学术图表设计师。检查图表类型是否匹配数据、坐标轴与单位、误差线含义、配色可达性、分辨率与期刊要求；给出具体重绘建议。', '图表规范与可视化建议'),
  roleAsset('responder', '审稿回复专家', '你是审稿回复专家。把每条审稿意见拆成「意见要点 / 我们的理解 / 修改位置 / 回复措辞」，回复须礼貌、具体、可核查，不辩解不空泛。', '逐条审稿回复撰写'),
];

/** 本项目撰写的约束（无第三方版权） */
function constraintAsset(key: string, title: string, rule: string, level: 'must' | 'must_not' | 'should', scope: 'all' | 'chat' | 'pipeline' | 'writing', tags: string[] = []): BuiltinAsset {
  return {
    key: `constraint-${key}`, kind: 'constraint', source: 'builtin-public', name: title, description: rule.slice(0, 80),
    tags: ['constraint', ...tags], manifest: { title, rule, level, scope },
  };
}

const CONSTRAINT_ASSETS: BuiltinAsset[] = [
  constraintAsset('cite-traceable', '引用可溯源', '每个事实性结论必须标注来源（文献/知识库/实验记录）；无来源时明确写「依据不足」。', 'must', 'all', ['citation']),
  constraintAsset('no-fabrication', '禁止编造', '不得编造文献、DOI、数据、实验结果或作者；不确定时如实说明并给验证方法。', 'must_not', 'all', ['integrity']),
  constraintAsset('units', '数值必须带单位', '所有数值必须带单位与统计口径（均值/中位数、样本量、置信区间）。', 'must', 'all', ['statistics']),
  constraintAsset('markdown-structure', '论文结构化输出', '论文类输出使用 Markdown 标题层级，正文只放 [n] 引用锚点，参考文献由前端渲染。', 'must', 'pipeline', ['writing']),
  constraintAsset('concise-chat', '聊天简洁', '聊天回答控制在 500 字内，必要时用要点列表；长文请落文档。', 'should', 'chat', ['ux']),
  constraintAsset('no-pii', '隐私数据不外泄', '不得在输出中复述密钥、令牌、身份证号、患者可识别信息；需要展示时脱敏。', 'must_not', 'all', ['security']),
  constraintAsset('declare-assumptions', '先声明假设', '涉及计算或推断时，先列出所用假设与数据口径，再给结论。', 'must', 'all', ['rigor']),
  constraintAsset(
    'plan-gates',
    '研究计划四道门',
    '涉及研究选题、研究计划、论文方案或投稿策略时，必须依次执行四道门：①查新门——先调用 research.novelty 或 literature.discover，记录检索式/来源/命中；工具不可用时标为「初稿未核验」并给出检索方案，不得把未核验缺口写成既定事实；②构念门——自变量、中介、因变量不得共用同一员工自评「感知」构念，必须写清来源、区分效度与共同方法偏差补救；③算术门——样本量、流失率、配对样本、周期间隔、招募与 IRB 时长必须能相互推导，冲突先改表再写正文；④复核门——文档写完后必须调用 research.plan_audit 与 quality.audit，存在 blocker 时不得标为可执行或可投稿。',
    'must',
    // 四道门必须覆盖写作档：聊天里起草研究计划会被识别为 longform writing，
    // 若只挂 chat，恰好绕过本约束。all 会在 chat/pipeline/writing 三档都生效。
    'all',
    ['research', 'workflow', 'rigor'],
  ),
  constraintAsset('limitations', '必须写局限', '研究类输出必须包含局限性段落，说明外部效度、数据偏差与方法限制。', 'must', 'pipeline', ['rigor']),
  constraintAsset('prisma', '综述遵循 PRISMA', '系统综述类任务必须报告检索库、检索式、纳入排除标准与筛选数量（PRISMA 流程）。', 'must', 'pipeline', ['review']),
  constraintAsset('ai-disclosure', '披露 AI 使用', '涉及投稿的材料必须提示作者按期刊要求披露 AI 辅助使用范围。', 'must', 'all', ['ethics']),
];

/** 本项目撰写的钩子 */
function hookAsset(key: string, name: string, event: 'chat:before' | 'chat:after' | 'pipeline:before' | 'pipeline:after', config: Record<string, unknown>, description: string): BuiltinAsset {
  return {
    key: `hook-${key}`, kind: 'hook', source: 'builtin-public', name, description,
    tags: ['hook', event], manifest: { event, type: 'prompt_inject', config },
  };
}

const HOOK_ASSETS: BuiltinAsset[] = [
  hookAsset('self-check', '结尾自检', 'chat:before', { text: '回答结束前自检：是否存在无来源的事实性断言？若有请标注或删除。' }, '回答前注入自检要求'),
  hookAsset('risk-note', '风险提示', 'chat:before', { text: '涉及医学、法律、投资等高风险内容时，结尾必须加一句风险提示。' }, '高风险领域提示'),
  hookAsset('pipeline-outline', '流水线先列提纲', 'pipeline:before', { text: '起草前先列章节提纲并核对文献覆盖，再展开正文。' }, '流水线起草前先提纲'),
  hookAsset('privacy-guard', '隐私拦截', 'chat:before', { text: '' }, '关键词命中即拦截（默认拦截密钥导出类请求）'),
];
// 隐私拦截使用 block 类型
HOOK_ASSETS[HOOK_ASSETS.length - 1].manifest = { event: 'chat:before', type: 'block', config: { when: 'keyword', keywords: ['导出密钥', '输出密钥', '打印密钥'], reason: '禁止导出密钥（安全策略）' } };

/** 提示词模板（映射到已有科研工具 key，覆盖默认提示词） */
function promptAsset(key: string, toolKey: string, name: string, prompt: string, description: string): BuiltinAsset {
  return {
    key: `prompt-${key}`, kind: 'prompt', source: 'builtin-public', name, description,
    tags: ['prompt', toolKey], manifest: { toolKey, prompt, enabled: 1 },
  };
}

const PROMPT_ASSETS: BuiltinAsset[] = [
  promptAsset('polish-nature', 'polish', '润色·Nature 风格', '你是 Nature 系列期刊的资深语言编辑。请在保持原意的前提下：1) 删除冗余与口语化表达；2) 统一术语与时态；3) 强化逻辑连接词；4) 保持句长 15-25 词。输出三段式：原文 / 润色文 / 修改理由（逐条对应）。', '顶刊风格润色（三段式输出）'),
  promptAsset('polish-reduce', 'polish', '降重·语义保真', '你是学术降重助手。在语义完全等价的前提下改写句式与用词，禁止改变数据、结论与引用编号。输出：原文 / 改写文 / 改动说明（列出同义替换与句式调整）。', '语义保真降重'),
  promptAsset('translate-bilingual', 'translate', '翻译·中英学术互译', '你是中英学术翻译专家。中文转英文时使用学术书面语与被动语态适度化；英文转中文时保留术语英文原词（首次出现加括号）。只输出译文，不解释。', '中英学术互译（术语保留）'),
  promptAsset('outline-imrad', 'writeOutline', '大纲·IMRaD 标准', '请按 IMRaD 结构生成论文大纲（Introduction / Methods / Results and Discussion / Conclusion），每节 3-6 个二级标题，并标注每节预计引用类型。只输出 JSON：{"title":"","sections":[{"title":"","subsections":[]}]}。', '标准 IMRaD 大纲'),
  promptAsset('draft-section-claim', 'draftSection', '起草·论点先行', '请以「段落论点句 + 证据 + 解释 + 过渡」四段式起草章节。每个事实性陈述后标注 [n] 引用锚点（对应提供的参考文献编号）。不得编造引用。', '论点先行式章节起草'),
  promptAsset('review-7dim', 'simulatedReview', '模拟评审·七维', '请以顶刊审稿人身份评审，输出 7 维评分（文献/逻辑/引用/语言/新颖/图表/格式，0-100）与每维 2 条具体问题，最后给推荐（接受/小修/大修/拒稿）。', '七维模拟评审'),
  promptAsset('gap-evidence', 'researchGap', '研究缺口·证据导向', '基于提供的文献摘要，找出 3-5 个研究缺口。每个缺口须给出：缺口描述 / 支撑证据（文献序号）/ 可行研究设计 / 预期贡献。禁止无证据猜测。', '有证据支撑的缺口分析'),
  promptAsset('extract-table', 'extractPaperTable', '结构化提取·对比表', '从文献中提取：研究问题、方法、数据、样本量、主要结果、局限。输出 Markdown 表格，缺失字段写「未报告」，不得推测。', 'Elicit 式结构化提取'),
  promptAsset('evidence-stance', 'evidenceSynthesis', '证据综合·立场分类', '对每个研究问题，将证据分为支持/部分支持/矛盾/证据不足四类，统计条目数并标注质量等级。结论必须与证据强度匹配。', 'Consensus 式证据综合'),
  promptAsset('cover-letter-fit', 'cover_letter', 'Cover Letter·契合度', '撰写投稿封面信：一句话贡献、与期刊 scope 的契合点、创新性、伦理与数据声明、推荐审稿人建议。控制在 350 词内。', '投稿封面信'),
  promptAsset('response-letter', 'response_letter', '审稿回复信·逐条', '把审稿意见逐条编号，每条给「意见原文 / 我们的回应 / 修改位置（页行）/ 修改摘要」。礼貌、具体、可核查。', '逐条审稿回复'),
  promptAsset('journal-match', 'journalsMatch', '选刊·匹配度', '根据标题与摘要推荐 5 本期刊，每本给：匹配理由、近三年相关发文方向、审稿周期（若已知）、风险提示。不得编造影响因子。', '选刊匹配建议'),
  promptAsset('summarize-topic-matrix', 'summarizeLiterature', '文献综述·主题矩阵', '按「背景 → 方法簇 → 证据冲突 → 研究空白 → 未来方向」组织综述，不要逐篇罗列。每个主题先给一句主张，再列 3-5 条证据（作者/年份/DOI），标注支持、部分支持或矛盾；最后给检索式与未解问题。找不到证据写「未检索到」，不得用常识补。', '主题矩阵式文献综述'),
  promptAsset('deep-dive-three-pass', 'deepDivePaper', '单篇精读·三遍法', '按三遍法精读：①标题/摘要/结论判断相关性；②图表/方法提取设计、样本、基线、指标；③复现细节与局限核对假设、统计前提、消融。输出 12 维矩阵：问题、假设、数据、方法、基线、指标、主结果、消融、局限、可复现性、可引用点、可借鉴点。缺失写「未报告」，引用给页码或章节。', '单篇论文三遍法精读'),
  promptAsset('abstract-four-sentence', 'generateAbstract', '摘要关键词·四句法', '摘要严格四句：问题与缺口、方法与数据、主要结果（带效应量与置信区间）、结论与意义。不写「首次」「重大突破」等无法验证的评价。随后给 5-8 个关键词，优先使用领域受控词表；英文摘要与中文摘要语义一致，不增加原文没有的结果。', '四句法摘要与关键词'),
  promptAsset('design-review-seven', 'designReview', '研究设计诊断·七问', '按七问审查研究设计：问题与方法是否匹配、变量如何操作化、抽样与偏倚、对照与混杂、样本量与功效、统计前提、可复现性。每问给风险等级、证据位置与可执行修改；无法判断时写明缺什么信息，不假设数据分布。', '研究设计七问诊断'),
  promptAsset('experiment-executable', 'experimentDesign', '实验设计·可执行', '输出可执行实验计划：自变量、因变量、控制变量、分组与随机化、盲法、样本量估算依据、主/次结局、统计检验与前提、失败回退、产物与随机种子。每个步骤写清输入、操作、预期输出与验收标准；不得省略对照组。', '可执行实验计划'),
  promptAsset('paper-comparison-schema', 'paperComparison', '文献对比·同口径', '把文献放进同一张对比表：研究问题、数据与样本、方法、基线、指标、主结果、效应量/置信区间、局限、可复现性。缺失字段写「未报告」，不要用不同口径的数字直接排名；最后给 3 条可比性限制与后续验证建议。', '同口径文献对比'),
  promptAsset('figures-journal-spec', 'generateFigures', '图表生成·期刊规范', '先判断数据适合的点图、箱线图、Kaplan-Meier 或热图，不默认柱状图。输出图注：图表类型、样本量、误差线含义、统计检验、单位与来源。坐标轴单位齐全，配色兼顾色盲与灰度打印，分辨率满足期刊要求；不得截断坐标轴制造差异。', '期刊规范图表与图注'),
  promptAsset('submission-email-state', 'parseSubmissionEmail', '投稿邮件解析·状态机', '解析编辑部邮件，输出：当前状态（收稿/送审/审稿中/决定中/修回/接收/拒稿）、置信度、依据原文、下一步动作与截止日期。区分「建议」与「已决定」，不把模板客套话当成接收；信息不足时列出需人工确认的字段。', '投稿邮件状态解析'),
];

/** SciFlow 自研优势工具（private，不导出、不对外） */
function privateAsset(key: string, kind: ExtensionKind, name: string, description: string, manifest: Record<string, unknown>, tags: string[]): BuiltinAsset {
  return { key, kind, source: 'builtin-private', name, description, tags: ['sciflow-private', ...tags], manifest };
}

const PRIVATE_ASSETS: BuiltinAsset[] = [
  privateAsset('sci-citation-audit', 'skill', 'SciFlow 引用体检', '自动核对正文 [n] 锚点与参考文献列表一一对应：孤儿锚点、未引用条目、重复 DOI、年份/作者不一致。输出可修复清单。', { mode: 'prompt', instructions: '检查正文引用锚点与参考文献的对应关系，列出：孤儿锚点、未引用条目、重复 DOI、元数据不一致（年份/作者/期刊），并给出逐条修复建议。' }, ['citation', 'quality']),
  privateAsset('sci-stat-audit', 'skill', '统计口径审计', '逐段扫描数值与统计表述：单位缺失、样本量不明、检验方法未报、P 值滥用、置信区间缺失。', { mode: 'prompt', instructions: '扫描文本中的每个数值与统计表述，标记：缺单位、缺样本量、未报检验方法、P 值无效应量、缺置信区间、口径前后不一致。输出表格与修改建议。' }, ['statistics', 'audit']),
  privateAsset('sci-repro-plan', 'skill', '可复现性方案', '为研究生成可复现包结构：环境锁定、数据字典、随机种子、运行脚本、预期输出与校验和。', { mode: 'prompt', instructions: '为给定研究生成可复现性方案：目录结构、环境锁定（版本与依赖）、数据字典、随机种子策略、一键运行脚本、预期产物与校验方式。' }, ['reproducibility']),
  privateAsset('sci-ethics-scan', 'skill', '伦理合规扫描', '检查知情同意、伦理批号、隐私脱敏、利益冲突、AI 使用披露，输出不合规项与整改建议。', { mode: 'prompt', instructions: '逐项检查：伦理审批号、知情同意、隐私脱敏、利益冲突声明、AI 使用披露、数据来源合法性；输出不合规项与整改建议。' }, ['ethics']),
  privateAsset('sci-figure-audit', 'skill', '图表规范审计', '检查图表类型与数据匹配、坐标轴单位、误差线含义、配色可达性、分辨率与期刊要求。', { mode: 'prompt', instructions: '审核图表：类型是否匹配数据分布、坐标轴与单位、误差线定义、配色对比度与色盲可达性、分辨率与期刊格式要求；给出重绘清单。' }, ['figures']),
  privateAsset('sci-novelty-scan', 'skill', '新颖性扫描', '对比给定文献集合，定位本研究与已有工作的差异点与潜在重叠，给出可主张的创新边界。', { mode: 'prompt', instructions: '对比本研究与提供的文献集合：列出重叠点、差异点、可主张的创新边界与需要补充的对比实验。禁止夸大新颖性。' }, ['novelty']),
  privateAsset('sci-grant-fit', 'skill', '基金契合度评估', '按资助方优先领域评估选题契合度，给出调整建议与可强调的社会/科学意义。', { mode: 'prompt', instructions: '按资助方优先领域评估选题：契合度评分、需强化的意义论证、风险与替代方案、预算合理性提示。' }, ['grant']),
  privateAsset('sci-journal-fit', 'skill', '投稿风险预判', '基于稿件特征预判桌面拒稿风险（scope/格式/伦理/统计），给出降低风险的具体动作。', { mode: 'prompt', instructions: '预判桌面拒稿风险：scope 契合、格式合规、伦理声明、统计完整性、语言质量；每项给风险等级与具体补救动作。' }, ['submission']),
  privateAsset('sci-reviewer-rebuttal', 'skill', '审稿答辩策略', '把审稿意见分为「必须补实验 / 可文字澄清 / 应拒绝但礼貌回应」三类，给答辩策略与话术。', { mode: 'prompt', instructions: '将审稿意见分为三类：必须补实验、可文字澄清、应礼貌拒绝；为每类给出答辩策略与可直接使用的英文话术。' }, ['review']),
  privateAsset('sci-reading-matrix', 'skill', '文献精读矩阵', '把一篇论文拆成 12 维矩阵：问题/假设/数据/方法/基线/指标/结果/消融/局限/可复现/引用价值/可借鉴点。', { mode: 'prompt', instructions: '按 12 维矩阵精读论文：研究问题、假设、数据、方法、基线、指标、主要结果、消融、局限、可复现性、引用价值、可借鉴点。缺失项写「未报告」。' }, ['reading']),
  privateAsset('sci-experiment-plan', 'skill', '实验计划生成', '输出可执行实验计划：变量、分组、样本量估算、随机化、盲法、分析计划、失败回退。', { mode: 'prompt', instructions: '生成实验计划：自变量/因变量/控制变量、分组与随机化、样本量估算依据、盲法、统计分析计划、失败与回退方案。' }, ['experiment']),
  privateAsset('sci-data-availability', 'skill', '数据可用性声明', '生成符合期刊要求的数据可用性声明（含仓库、DOI、访问条件、受限数据说明）。', { mode: 'prompt', instructions: '生成数据可用性声明：数据仓库与 DOI、代码仓库、访问条件、受限数据原因与申请方式、FAIR 合规说明。不得编造 DOI。' }, ['data']),
  privateAsset('sci-prompt-hardening', 'skill', '提示词加固器', '把用户草拟的提示词改写为可执行规格：角色、输入、步骤、输出 schema、拒答边界、自检项。', { mode: 'prompt', instructions: '把用户草拟的提示词改写为可执行规格：角色定义、输入契约、步骤、输出 schema、拒答边界、自检清单。保持用户原意。' }, ['prompt-engineering']),
];

export const BUILTIN_EXTENSION_ASSETS: BuiltinAsset[] = [
  ...MCP_ASSETS,
  ...SKILL_ASSETS,
  ...ROLE_ASSETS,
  ...CONSTRAINT_ASSETS,
  ...HOOK_ASSETS,
  ...PROMPT_ASSETS,
  ...PRIVATE_ASSETS,
];
