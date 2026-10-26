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
}

/** 社区 MCP（真实仓库；仅 context7/deepwiki 提供公开 HTTP 端点可直接连接） */
const MCP_ASSETS: BuiltinAsset[] = [
  {
    key: 'mcp-context7', kind: 'mcp', source: 'builtin-public', name: 'Context7（库文档检索）',
    description: '按库名/版本实时取官方文档片段，写代码或核对 API 时避免凭记忆编造。远程 HTTP 端点，开箱可连。',
    repo: 'upstash/context7', license: 'MIT', url: 'https://mcp.context7.com/mcp',
    install: '远程 HTTP：https://mcp.context7.com/mcp', tags: ['docs', 'remote'],
    manifest: { transport: 'http', url: 'https://mcp.context7.com/mcp', tools: ['resolve-library-id', 'get-library-docs'] },
  },
  {
    key: 'mcp-deepwiki', kind: 'mcp', source: 'builtin-public', name: 'DeepWiki（仓库知识库）',
    description: '把任意 GitHub 仓库转成可问答的工程知识库，适合读开源实现细节。远程 HTTP 端点。',
    repo: 'regenrek/deepwiki-mcp', license: 'MIT', url: 'https://mcp.deepwiki.com/mcp',
    install: '远程 HTTP：https://mcp.deepwiki.com/mcp', tags: ['repo', 'remote'],
    manifest: { transport: 'http', url: 'https://mcp.deepwiki.com/mcp' },
  },
  {
    key: 'mcp-arxiv', kind: 'mcp', source: 'builtin-public', name: 'arXiv MCP（预印本检索与全文）',
    description: '本地 MCP：检索 arXiv、下载 PDF、按章节读 LaTeX、导出 BibTeX。约 3.2k star。',
    repo: 'blazickjp/arxiv-mcp-server', license: 'Apache-2.0',
    install: 'pip install arxiv-mcp-server（stdio，需以 HTTP 方式暴露后接入）', tags: ['literature', 'arxiv'],
    manifest: { transport: 'stdio', command: 'uvx arxiv-mcp-server', tools: ['search_papers', 'download_paper', 'read_paper'] },
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
    manifest: { transport: 'http', url: 'http://localhost:3000/mcp', tools: ['deep_research'] },
  },
  {
    key: 'mcp-agentset', kind: 'mcp', source: 'builtin-public', name: 'Agentset（RAG 平台）',
    description: '开源 RAG 平台，内置引用与 deep research，支持 22+ 文件格式。约 2.1k star。',
    repo: 'agentset-ai/agentset', license: 'MIT',
    install: 'docker compose up（自托管 HTTP）', tags: ['rag', 'citations'],
    manifest: { transport: 'http', url: 'http://localhost:3001/mcp' },
  },
  {
    key: 'mcp-docsagent', kind: 'mcp', source: 'builtin-public', name: 'DocsAgent（私有文档问答）',
    description: '给 agent 提供个人知识库的私有访问，支持增量索引。',
    repo: 'docsagent/docsagent', license: 'MIT',
    install: 'docker run docsagent（HTTP）', tags: ['docs', 'knowledge'],
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
    key: 'mcp-mcp-obsidian-vault', kind: 'mcp', source: 'builtin-public', name: 'Obsidian Wiki（数字大脑）',
    description: '让 agent 通过 Markdown 维护个人知识库（Zettelkasten 风格）。约 3.6k star。',
    repo: 'Ar9av/obsidian-wiki', license: 'MIT',
    install: 'git clone https://github.com/Ar9av/obsidian-wiki', tags: ['notes', 'knowledge'],
    manifest: { transport: 'stdio' },
  },
  {
    key: 'mcp-llm-for-zotero', kind: 'mcp', source: 'builtin-public', name: 'LLM for Zotero（文献库研究代理）',
    description: '面向 Zotero 库的开源研究代理系统：整库问答、跨文献综合。约 3.4k star。',
    repo: 'yilewang/llm-for-zotero', license: 'MIT',
    install: 'git clone https://github.com/yilewang/llm-for-zotero', tags: ['zotero', 'agent'],
    manifest: { transport: 'stdio' },
  },
];
/** 社区 Skills / 规则 / 提示词集合（仓库级引用 + 本项目撰写的适配说明） */
const SKILL_ASSETS: BuiltinAsset[] = [
  {
    key: 'skill-anthropic-official', kind: 'skill', source: 'builtin-public', name: 'Anthropic 官方 Skills 集',
    description: '官方 Skills 仓库（文档处理、表格、PDF、演示等），可作为 SKILL.md 规范参考与直接导入源。',
    repo: 'anthropics/skills', license: 'MIT', install: 'git clone https://github.com/anthropics/skills',
    tags: ['official', 'docs'], manifest: { mode: 'reference', importHint: '拖入仓库内某个 skill 目录或压缩包即可导入' },
  },
  {
    key: 'skill-academic-research', kind: 'skill', source: 'builtin-public', name: 'Academic Research Skills（全流程）',
    description: '面向 Claude Code 的学术科研技能集：检索 → 写作 → 评审 → 投稿全流程。约 53.9k star。',
    repo: 'Imbad0202/academic-research-skills', license: 'MIT', install: 'git clone https://github.com/Imbad0202/academic-research-skills',
    tags: ['academic', 'workflow'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-codex-academic', kind: 'skill', source: 'builtin-public', name: 'Codex/Claude 学术三件套',
    description: '文献阅读、论文写作、科学计算三个科研技能，中文场景适配好。约 5.3k star。',
    repo: 'zLanqing/codex-claude-academic-skills', license: 'MIT', install: 'git clone https://github.com/zLanqing/codex-claude-academic-skills',
    tags: ['academic', 'chinese'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-agent-research', kind: 'skill', source: 'builtin-public', name: 'Agent Research Skills（系统综述）',
    description: 'deep-research 技能：系统化文献综述与证据表。',
    repo: 'lingzhi227/agent-research-skills', license: 'MIT', install: 'git clone https://github.com/lingzhi227/agent-research-skills',
    tags: ['systematic-review'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-claude-scholar', kind: 'skill', source: 'builtin-public', name: 'Claude Scholar（科研助手）',
    description: '半自动科研助手：选题、实验、写作、投稿的组合技能。约 5.9k star。',
    repo: 'Galaxy-Dawn/claude-scholar', license: 'MIT', install: 'git clone https://github.com/Galaxy-Dawn/claude-scholar',
    tags: ['research', 'workflow'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-humanizer', kind: 'skill', source: 'builtin-public', name: 'Academic Humanizer（去 AI 味）',
    description: '去除论文/基金申请书中的 AI 写作痕迹，保留学术严谨性。约 2.6k star。',
    repo: 'AIScientists-Dev/academic-humanizer', license: 'MIT', install: 'git clone https://github.com/AIScientists-Dev/academic-humanizer',
    tags: ['writing', 'style'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-claude-prism', kind: 'skill', source: 'builtin-public', name: 'Claude Prism（离线写作工作台）',
    description: '离线优先的科学写作工作区，含 LaTeX 与引用工作流。约 1.8k star。',
    repo: 'delibae/claude-prism', license: 'MIT', install: 'git clone https://github.com/delibae/claude-prism',
    tags: ['writing', 'latex'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-latte-review', kind: 'skill', source: 'builtin-public', name: 'LatteReview（LLM 系统综述流水线）',
    description: '可编排的 LLM 系统综述包：筛选、抽取、质量评估。',
    repo: 'PouriaRouzrokh/LatteReview', license: 'MIT', install: 'pip install lattreview',
    tags: ['systematic-review', 'pipeline'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-paper-proofreading', kind: 'skill', source: 'builtin-public', name: 'Paper Proofreading Prompts',
    description: 'Claude Code 驱动的论文校对提示词集（语法/一致性/术语）。',
    repo: 'LimHyungTae/awesome-claudecode-paper-proofreading', license: 'MIT', install: 'git clone https://github.com/LimHyungTae/awesome-claudecode-paper-proofreading',
    tags: ['proofreading'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-ai-research-writing', kind: 'skill', source: 'builtin-public', name: 'AI Research Writing 模板库',
    description: '来自顶尖研究机构的论文写作 Prompt 模板与 Agent Skills 集合。',
    repo: 'STRYXTN/awesome-ai-research-writing', license: 'MIT', install: 'git clone https://github.com/STRYXTN/awesome-ai-research-writing',
    tags: ['writing', 'templates'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-deep-research-prompts', kind: 'skill', source: 'builtin-public', name: 'Deep Research Prompts',
    description: '面向 OpenAI/Gemini/Qwen 的 deep research 提示词集。',
    repo: 'langgptai/awesome-deep-research-prompts', license: 'MIT', install: 'git clone https://github.com/langgptai/awesome-deep-research-prompts',
    tags: ['deep-research', 'prompts'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-agent-skills-1000', kind: 'skill', source: 'builtin-public', name: 'Awesome Agent Skills（1000+）',
    description: '官方团队与社区的一千余个 agent skill 索引，可按需挑选导入。约 36k star。',
    repo: 'VoltAgent/awesome-agent-skills', license: 'MIT', install: 'git clone https://github.com/VoltAgent/awesome-agent-skills',
    tags: ['catalog'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-webfuse-autoresearch', kind: 'skill', source: 'builtin-public', name: 'Awesome Autoresearch（自主研究循环）',
    description: '自主改进循环与研究 agent 的精选集合，适合搭建长期研究流程。',
    repo: 'webfuse-com/awesome-autoresearch', license: 'MIT', install: 'git clone https://github.com/webfuse-com/awesome-autoresearch',
    tags: ['autoresearch', 'catalog'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-agent-loop', kind: 'skill', source: 'builtin-public', name: 'Agent Loop Skills（迭代自评循环）',
    description: '可插拔的 agentic loop：自主研究、科学写作、迭代评审直到收敛。',
    repo: 'gaasher/Agent-Loop-Skills', license: 'MIT', install: 'git clone https://github.com/gaasher/Agent-Loop-Skills',
    tags: ['loop', 'writing'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-paper-craft', kind: 'skill', source: 'builtin-public', name: 'PaperCraft（顶会论文 17 条规则）',
    description: '面向顶会投稿的 17 条写作规则与检查清单。',
    repo: 'charlotte-12s/paper-craft', license: 'MIT', install: 'git clone https://github.com/charlotte-12s/paper-craft',
    tags: ['writing', 'rules'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-flonat-research', kind: 'skill', source: 'builtin-public', name: 'Flonat Research（博士研究基建）',
    description: '面向博士研究者的 Claude Code / Codex 共享基建（技能与工作流）。',
    repo: 'flonat/flonat-research', license: 'MIT', install: 'git clone https://github.com/flonat/flonat-research',
    tags: ['phd', 'workflow'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-scientific-agent-skills', kind: 'skill', source: 'builtin-public', name: 'Scientific Agent Skills',
    description: '把任意 agent 变成科研助手的技能集（跨 Gemini/Claude/Cursor/Codex）。',
    repo: 'dongchankim-io/scientific-agent-skills', license: 'MIT', install: 'git clone https://github.com/dongchankim-io/scientific-agent-skills',
    tags: ['science', 'cross-platform'], manifest: { mode: 'reference' },
  },
  {
    key: 'skill-ai-agent-papers', kind: 'skill', source: 'builtin-public', name: 'AI Agent Papers（研究论文精选）',
    description: 'agent 领域研究论文精选，适合做相关工作综述的起点。',
    repo: 'VoltAgent/awesome-ai-agent-papers', license: 'MIT', install: 'git clone https://github.com/VoltAgent/awesome-ai-agent-papers',
    tags: ['papers', 'catalog'], manifest: { mode: 'reference' },
  },
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
function constraintAsset(key: string, title: string, rule: string, level: 'must' | 'must_not' | 'should', scope: 'all' | 'chat' | 'pipeline', tags: string[] = []): BuiltinAsset {
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
