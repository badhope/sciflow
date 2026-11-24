# AI 科研助手竞品、场景边界与可行性论证

> 版本锚点：`v1.19.17` / `d9dc71b`（2026-11-24）。
> 本文回答三个问题：**SciFlow 与通用 AI 应用的边界在哪、开源科研工具强在哪弱在哪、端到端全自动科研链路凭什么做得成**。
> 所有竞品事实均附来源；厂商自述与第三方评测分开标注，不把营销口径当成独立验证。

## 1. 结论先行

1. **通用 AI 应用的强项是“找证据、读文献、写报告”，不是“把研究做完”。** OpenAI Deep Research、NotebookLM、Elicit、Consensus、SciSpace 的闭环基本停在“检索—综合—写作/展示”；实验设计、沙箱执行、评审回边、确定性质量门、投稿包，普遍缺失或只做局部。
2. **开源科研工具强在自托管、模型自由、内容摄入，弱在“闭环 + 可审计 + 交付”。** Open Notebook 是知识库/笔记，GPT Researcher 是深度报告，PaperQA2 是文献问答，AI Scientist 是窄领域论文生成器；没有一个同时覆盖本地优先、证据链、实验执行、质量门与投稿。
3. **SciFlow 的不可替代点不是“又一个 AI 论文摘要器”，而是：本地优先 + 可审计证据链 + 多轮科研回边 + 确定性质量门 + 投稿交付。** 这条链路在 1.19.17 已有真实 LangGraph 实现与真实沙箱执行，不是概念 Demo；当前主要缺口是可靠性、可观测性与提示词覆盖，而不是从零造能力。
4. **“全自动”必须分级，并且每一级都要有刹车。** 本产品应明确支持 L2（人审协议）/L3（AI 专家审+审计）两档；L4 无人值守不是当前承诺。没有预算门、停滞判定、断点恢复、证据覆盖率的“全自动”，只是把幻觉跑得更快。

## 2. 竞品全景

### 2.1 通用 AI 应用

| 产品 | 官方/可验证能力 | 边界与短板 | 来源 |
| --- | --- | --- | --- |
| OpenAI Deep Research | 用推理自主浏览、分析、综合大量在线来源；支持上传文件、Python 工具、图表；输出带句子/段落级引用与来源清单；可审阅和修改研究计划 | 面向 web/文件研究，不提供本地实验执行、科研对象模型、质量门与投稿包；云端托管 | [OpenAI 官方](https://help.openai.com/en/articles/10500283-deep-research)、[API 文档](https://developers.openai.com/api/docs/guides/deep-research) |
| Google NotebookLM / Gemini Notebook | 以用户上传来源为 grounding；PDF/网页/YouTube/音频/Google Docs 等；回答带可回跳引用；Audio/Video Overview、思维导图、学习指南 | 知识库/理解工具，不做文献全库检索、不做实验、不做投稿；云托管 | [官方产品页](https://notebooklm.google)、[教育版说明](https://edu.google.com/ai-notebooklm/) |
| Elicit | 138M+ 论文、545k 临床试验；Research Agent 跨数据库/期刊/公共数据/上传文档；报告、表格、图表、生信分析、幻灯片；系统综述自动筛选与数据抽取；句级引用；API/MCP | 强在检索与证据综合；不做实验执行、不做本地部署、不做完整投稿包；自动抽取仍需人工复核 | [Elicit 官网](https://elicit.com/) |
| Consensus | 200M+ 学术文档，聚合 Semantic Scholar、OpenAlex 与自有爬取；先检索再综合；每条回答带引用；Consensus Meter、Deep Review、Citation Graph；API/MCP | 强在证据问答/综述；不做实验设计/执行、写作全稿与投稿；云托管 | [Consensus 图书馆页](https://consensus.app/home/resources/consensus-for-university-libraries/) |
| SciSpace | 280M+ 多库检索（Google Scholar/PubMed/arXiv/OpenAlex/Semantic Scholar）；PDF chat、跨论文抽取、系统综述、AI Writer + 参考文献管理、500+ agents | 覆盖“检索—阅读—写作”；不做本地实验执行与确定性质量门；云托管 | [SciSpace vs Elicit](https://scispace.com/compare/elicit) |

### 2.2 开源科研工具

| 项目 | 能力与优势 | 短板 | 来源 |
| --- | --- | --- | --- |
| Open Notebook | MIT；自托管；20+ 模型提供商（含 Ollama/LM Studio/OpenAI-compatible）；PDF/视频/音频/网页/Office 多模态摄入；全文+向量检索；带引用对话；REST API/MCP；FastAPI + Next.js + SurrealDB | 定位是 NotebookLM 替代：知识库、笔记、对话、播客；不做假设生成、实验协议、Python 沙箱、质量门、投稿 | [GitHub](https://github.com/lfnovo/open-notebook) |
| GPT Researcher | 规划者/执行者/发布者多 agent；web + 本地文档；带引用报告；递归 Deep Research；MCP；PDF/Word 导出；单报告成本可追踪 | 产出是研究报告；不做实验执行、科研对象谱系、确定性质量门、投稿包 | [GitHub](https://github.com/assafelovic/gpt-researcher) |
| PaperQA2 | 科学文献 RAG agent；全文索引、文献检索、证据收集、引用图；向量召回 + LLM 重排/上下文摘要（RCS）；支持本地文档与引用溯源；作者称在 LitQA2 上超过博士/博士后水平 | 强在文献问答与证据综合；不做实验、不做稿件全流程、不做投稿；论文中的“超人类”是特定 benchmark 结论 | [FutureHouse 公告](https://www.futurehouse.org/research-announcements/wikicrow)、[论文](https://arxiv.org/pdf/2409.13740v2) |
| The AI Scientist | 端到端“想法→实验→论文→评审”；NanoGPT/2D Diffusion/Grokking 模板；自动生成 LaTeX 论文与 LLM 评审 | 依赖 GPU 与固定模板；执行 LLM 代码有安全风险，官方明确要求容器化与限制网络；不覆盖广泛科研场景、质量门、投稿交付 | [GitHub](https://github.com/SakanaAI/AI-Scientist) |

### 2.3 工程类开源参照：OpenCode

OpenCode 是开源 coding agent，提供 CLI、桌面、Web、Docker 多形态，内置多模型提供商、配置、插件、MCP、命令与权限体系（[官方文档](https://opencode.ai/docs/)）。SciFlow 要吸收的是它的**工程骨架**，不是它的编码界面：

- 工具注册与权限边界：哪些工具可读、可写、可执行，必须显式授权；
- 会话与任务生命周期：长任务、后台任务、断点、取消；
- MCP/插件生态：外部能力按需接入，不把核心链路绑死；
- 诊断与可观测：工具调用、错误、上下文预算可追踪。

**不吸收**：与科研无关的代码编辑 UI、通用 IDE 功能、为了“功能多”而堆的插件市场。

## 3. 功能对标矩阵

> 图例：`●` 完整能力；`◐` 部分/有限；`○` 不具备或未验证。  
> “实验执行”指真实代码/数据运行，不是生成实验方案文本。

| 维度 | SciFlow | Elicit | Consensus | SciSpace | NotebookLM | Deep Research | Open Notebook | GPT Researcher | PaperQA2 | AI Scientist |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 学术全库检索 | ● OpenAlex/Crossref/arXiv | ● 138M+ | ● 200M+ | ● 280M+ | ○ | ◐ web/文件 | ◐ 自建来源 | ● web+本地 | ● 本地索引 | ◐ Semantic Scholar/OpenAlex |
| 句级/段落级引用 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ◐ |
| 系统综述/数据抽取 | ◐ 证据库+claim/evidence | ● PRISMA/筛选/抽取 | ◐ Deep Review | ● | ○ | ○ | ○ | ○ | ◐ | ○ |
| 单篇精读/跨篇对比 | ● | ● | ● | ● | ● | ◐ | ● | ◐ | ● | ◐ |
| 假设/协议生成 | ● PI agent | ◐ 研究问题/报告 | ○ | ◐ agent | ○ | ◐ 研究计划 | ○ | ○ | ○ | ● 模板内 |
| 沙箱实验执行 | ● Python sandbox | ○ | ○ | ○ | ○ | ◐ Python 工具 | ○ | ○ | ○ | ● 需 GPU/容器 |
| 多轮评审回边 | ● Critic→decide→revise | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ 生成-评审一次 |
| 确定性质量门 | ● 七维+客观检查 | ◐ 引用核验 | ◐ 引用回跳 | ◐ | ○ | ○ | ○ | ○ | ◐ | ○ |
| 全稿写作/格式 | ● 长篇+导出 | ◐ 报告 | ○ | ● AI Writer | ◐ 学习材料 | ◐ 报告 | ○ | ◐ 报告 | ○ | ● LaTeX 模板 |
| 投稿包/期刊匹配 | ● readiness+ZIP+cover letter | ○ | ○ | ◐ 格式/引用 | ○ | ○ | ○ | ○ | ○ | ○ |
| 本地优先/自托管 | ● 单 SQLite/桌面 | ○ 云 | ○ 云 | ○ 云 | ○ 云 | ○ 云 | ● Docker | ◐ 可自托管 | ● 本地索引 | ● 本地代码 |
| 模型自由 | ● 本地/远程多协议 | ○ | ○ | ○ | ○ | ○ | ● 20+ | ● 多 LLM | ● 可配置 | ● 多模型 |
| 断点恢复/看门狗 | ● 本阶段新增 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 成本/预算控制 | ● token 预算+usage | ◐ 订阅额度 | ◐ | ◐ | ○ | ◐ | ◐ | ● 成本追踪 | ◐ | ◐ |
| 可审计证据链 | ● claim→evidence→run→code/stdout | ◐ 引用 | ◐ 引用 | ◐ 引用 | ◐ 引用 | ◐ 来源清单 | ◐ 引用 | ◐ 来源 | ● 引用 | ◐ 论文 |

### 3.1 场景边界：通用 AI vs 科研助手

| 场景 | 通用 AI 应用 | SciFlow 应承担的部分 |
| --- | --- | --- |
| “这个领域最近有什么进展？” | 强：检索+综述 | 做，但必须落到可复用证据库与引用锚点 |
| “帮我找 20 篇相关论文并抽取变量” | 强：Elicit/SciSpace 更快 | 做，但强调本地留存、项目级证据与后续 claim 绑定 |
| “这个假设是否成立？设计一个能验证它的实验” | 弱：只给方案，不执行 | **核心差异**：协议→沙箱代码→真实 stdout→Critic 判定 |
| “跑完之后结论不成立，下一步改什么？” | 弱：一次性回答 | **核心差异**：多轮回边+停滞判定+修订反馈 |
| “这篇稿子能不能投？投哪里？投稿包齐不齐？” | 弱：给建议，不交付 | **核心差异**：确定性 readiness+期刊匹配+ZIP+cover letter |
| “数据不能出本机” | 云产品不满足 | **核心差异**：本地 SQLite+本地模型端点 |
| “三个月后我要能复现这次结论” | 弱：聊天记录不等于证据 | **核心差异**：run/code/stdout/evidence 全落库 |

### 3.2 开源生态的优势与短板

**优势（应吸收）**

- 自托管与模型自由：Open Notebook 的 20+ provider 矩阵、PaperQA2 的可配置 LLM/嵌入/向量库、AI Scientist 的多模型支持。
- 内容摄入广度：Open Notebook 的 PDF/视频/音频/网页/Office；PaperQA2 的 PDF/Office/代码/图表。
- 检索质量：PaperQA2 的向量召回 + LLM 重排 + 上下文摘要（RCS），比单纯 embedding 更抗噪声。
- 深度研究编排：GPT Researcher 的 planner/executor/publisher 与递归深度；AI Scientist 的 idea→experiment→paper→review。
- 工程骨架：OpenCode 的工具/权限/会话/MCP/插件体系。

**短板（不能照搬）**

- 大多数开源项目停在“知识库/报告/问答”，没有科研对象模型（hypothesis/protocol/run/claim/evidence），因此无法做可审计的多轮闭环。
- AI Scientist 虽然闭环，但依赖固定模板、GPU 与 LLM 代码执行；官方自己要求容器化、限制网络。它不是通用科研工作台。
- 开源项目的“引用”多是回答级引用，不等于“结论→证据→实验输出”的可核验链。
- 自托管不等于安全：本地模型也可能幻觉，沙箱也可能被绕过；必须有确定性门与权限边界。

## 4. SciFlow 差异化建设路径

### 4.1 不可替代点（按优先级）

1. **本地优先的数据主权**：一个 SQLite 文件装下项目、文献、知识库、实验、稿件、投稿包；模型端点由用户决定。对标云产品无法承诺的“数据不出本机”。
2. **可审计证据链**：每个 claim 必须能追到 evidence，再追到 run 的 code/stdout；没有证据的结论应被硬门拦截，而不是只给一句“置信度”。
3. **真正的科研回边**：不是“生成一段实验方案”，而是协议→沙箱执行→Critic 判定→修订→再执行；支持人工/AI 专家两种审批，失败 fail-closed。
4. **确定性质量门 + 投稿交付**：七维评审之外，重复段落、引用缺失、格式硬伤由确定性检查器判定；投稿 readiness、期刊匹配、ZIP、cover letter 形成交付闭环。
5. **长跑可靠性**：断点恢复、心跳看门狗、预算门、停滞判定、运行轨迹；这决定“全自动”能不能真的无人值守跑几小时。

### 4.2 从竞品学什么、不学什么

| 来源 | 学 | 不学 |
| --- | --- | --- |
| Elicit | 系统综述筛选/抽取、句级引用、API/MCP、报告可定制 | 纯云端、无实验执行、无本地数据主权 |
| Consensus | “先检索再综合”、Consensus Meter、引用回跳、撤稿排除 | 只做证据问答、不做实验/投稿 |
| SciSpace | 多库检索、PDF chat、跨论文抽取、AI Writer+参考文献管理 | 云端托管、以写作/格式化为终点 |
| NotebookLM | 源 grounding、精确引用、多模态摄入、音频/视频表达 | 只做理解/学习，不做研究闭环 |
| OpenAI Deep Research | 计划可审阅、来源清单、长报告结构、Python 工具 | 云托管、无科研对象/质量门/投稿 |
| Open Notebook | 自托管、20+ provider、内容摄入、REST/MCP | 只做知识库/笔记/播客 |
| GPT Researcher | planner/executor/publisher、递归深度、成本追踪 | 报告即终点、无实验/质量门 |
| PaperQA2 | RCS 重排、引用图、撤稿检查、本地索引 | 只做文献问答 |
| AI Scientist | idea→experiment→paper→review、模板化复现 | 固定模板/GPU 依赖、无通用质量门与投稿 |
| OpenCode | 工具注册、权限、会话、MCP、诊断 | 通用 IDE 功能与插件堆砌 |

## 5. AI 科研潜能释放的可行性论证

### 5.1 为什么现在能做成（不是空想）

1. **基础设施成熟**：LangGraph 提供持久化 checkpoint、interrupt/resume 与多轮图编排；SQLite + sqlite-vec + FTS5 能在单机实现可用的混合检索；Python 沙箱能执行真实统计实验。
2. **产品骨架已在**：1.19.17 已有 program/cycle/question/hypothesis/protocol/run/claim/evidence 对象、PI/实验者/Critic/专家四类 agent、人工/AI 两种审批、预算/停滞/修复分支；不是从零起步。
3. **真实链路已验证**：本轮压测在 `AI_MOCK=1` 下跑真实 HTTP + 真实 Python 沙箱 + 真实 LangGraph，11/11 通过；覆盖全自动并发、人工放行/驳回、AI 专家驳回、预算耗尽、连续反驳停滞。
4. **风险可被工程化约束**：预算门、停滞判定、fail-closed 专家审批、断点恢复、看门狗、确定性质量门，都是可测试的工程件，不依赖模型“自觉”。

### 5.2 自动化分级（必须写进产品）

| 级别 | 定义 | 人需要做什么 | 适用场景 | 当前状态 |
| --- | --- | --- | --- | --- |
| L0 | 辅助问答/摘要 | 人做完研究，AI 只帮忙 | 快速了解领域 | 已支持 |
| L1 | 工作流自动化 | 人给步骤，AI 执行单步 | 文献抽取、格式检查 | 已支持 |
| L2 | 闭环但人审协议 | 人批方案，AI 跑实验/评审/修订 | 大多数真实研究 | 已支持（默认） |
| L3 | AI 专家审批+审计 | 人只看终态与异常 | 高吞吐、低风险探索 | 已支持（可配） |
| L4 | 无人值守长跑 | 人只在异常时介入 | 未来，不是当前承诺 | 未承诺 |

> 关键判断：**L3 的门槛不是“模型更强”，而是“审计与刹车更硬”**。没有证据覆盖率、预算、恢复、看门狗，L3 不应开放。

### 5.3 三条可行性路径

**路径 A：可靠性优先（当前主路径）**

- 完成 R-01~R-08：启动恢复、看门狗、手动恢复、预算前移、真实重启、长稳压测。
- 验收：kill 后能续跑或明确 blocked；20 轮以上无锁泄漏；`/metrics` 可见状态。
- 这是“全自动”能不能落地的前置条件。

**路径 B：证据链与质量门**

- claim 必须绑定 evidence；evidence 必须能追到 run 的 code/stdout；无证据结论硬门拦截。
- 七维评审 + 确定性检查器 + 项目级质量标准；投稿 readiness 复用同一门禁。
- 验收：任取一条结论，能一路点到实验输出；删除证据后结论被降级/拦截。

**路径 C：生态融合与能力纵深**

- 吸收 PaperQA2 的 RCS 重排、Open Notebook 的 provider 矩阵、OpenCode 的工具/权限骨架。
- 向量知识库增量升级：reranker、嵌入版本化、维度迁移、金标集；不重复造已有 RRF/MMR。
- 验收：金标集上有可复现的提升数字；第三方能力均绑定科研主链。

### 5.4 风险与刹车

| 风险 | 表现 | 刹车 |
| --- | --- | --- |
| 引用幻觉 | 结论引用不存在的文献 | 无文献池禁用引用；句级回跳；引用体检硬伤 |
| 合成数据外推 | 代理实验被当成真实结论 | 沙箱 goal 标注“代理模拟”；Critic 必须写局限；质量门提示 |
| p-hacking/多次试错 | 反复改阈值直到显著 | 预算/轮次/停滞上限；设计 hash 记录；禁止只报最优 |
| 代码执行安全 | LLM 代码删库/联网/吸血 | 容器/沙箱、env 白名单、超时/内存/输出截断、禁网 |
| 成本失控 | 无限循环烧 token | 预算门前移、usage 对账、看门狗 |
| 不可复现 | 聊天记录丢失、模型漂移 | run/code/stdout/evidence 全落库；checkpoint；版本锚点 |
| “假全自动” | 流程跑完但没人能审 | 证据覆盖率、审计轨迹、人工/AI 审批点 |

### 5.5 成功指标（建议纳入后续验收）

| 指标 | 目标方向 | 口径 |
| --- | --- | --- |
| 全自动循环完成率 | ≥ 95%（mock/受控场景） | 启动后到达 synthesize 或明确终止原因 |
| 断点恢复成功率 | 100%（有 checkpoint） | kill 后重启，能续跑或明确 blocked |
| 证据覆盖率 | 100% claim 有 evidence | 无证据 claim 数量为 0 |
| 预算越界率 | 0 | 计划阶段超预算不执行实验 |
| 长稳无锁泄漏 | 20+ 轮 0 卡死 | 运行锁/心跳/DB busy |
| 单轮成本 | 可配置上限内 | token 对账 |
| 人工介入率 | L3 下只处理异常 | 审批/驳回/恢复次数 |

## 6. 对 SciFlow 的具体建议（按季度节奏）

### 本季度（可靠性 + 基线）

1. 完成真实重启验收（R-06）与长稳压测（S-03）。
2. 把 `/health/deep` 与 `/metrics` 的研究循环指标接入桌面托盘/运维文档。
3. 基线文档四模块合入 `main`，五远端对齐。
4. README 补功能矩阵截图（用现有 24 张，不重造）。

### 下季度（证据链 + 代码重构）

1. claim→evidence→run 的硬门与 UI 追溯。
2. `ResearchCycleService` / `PipelineService` 拆分；DB 迁移模块化。
3. 提示词分支矩阵与契约测试；mock 规则必须对应真实 prompt 特征。
4. 向量知识库金标集与 reranker 评估。

### 再下一季度（生态 + 交付）

1. OpenCode 式工具权限/会话骨架；PaperQA2 式 RCS 重排。
2. 投稿包与期刊匹配的真实用户验收。
3. 桌面安装包签名、移动端 PWA 验收。
4. 五个内容社区发布包（有凭据才执行）。

## 7. 参考来源

- Elicit 官网：<https://elicit.com/>
- Consensus 图书馆页：<https://consensus.app/home/resources/consensus-for-university-libraries/>
- SciSpace vs Elicit：<https://scispace.com/compare/elicit>
- OpenAI Deep Research 帮助中心：<https://help.openai.com/en/articles/10500283-deep-research>
- OpenAI Deep Research API：<https://developers.openai.com/api/docs/guides/deep-research>
- NotebookLM 官网：<https://notebooklm.google>
- NotebookLM 教育版：<https://edu.google.com/ai-notebooklm/>
- Open Notebook GitHub：<https://github.com/lfnovo/open-notebook>
- GPT Researcher GitHub：<https://github.com/assafelovic/gpt-researcher>
- PaperQA2 公告：<https://www.futurehouse.org/research-announcements/wikicrow>
- PaperQA2 论文：<https://arxiv.org/pdf/2409.13740v2>
- AI Scientist GitHub：<https://github.com/SakanaAI/AI-Scientist>
- OpenCode 文档：<https://opencode.ai/docs/>
