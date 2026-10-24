# SciFlow 配置指南
> 不是参数罗列手册。按「你想怎么用」来组织——每个场景一份可直接抄的配置，附上当它不工作时该看哪里。

---

## 先想清楚：你的模型从哪来

SciFlow 是**零内置模型**的产品。它不附带任何 LLM、任何嵌入模型、任何云服务账号——所有 AI 能力都来自**你自己**的配置。这不是限制，是产品立场：你的 Key、你的额度、你的数据，从第一行配置开始就在你手里。

三条路线，按需选择：

| 路线 | 适合谁 | 体验 |
|---|---|---|
| **本地推理**（Ollama / LM Studio） | 数据绝不出机器、有显卡或大内存 | 慢一些，但物理隔离 |
| **国内云 API**（豆包 / DeepSeek / 通义 / 智谱 / Kimi） | 要质量、要速度，接受按量付费 | 流水线全速跑 |
| **混合**（云模型 + 本地嵌入） | 主力用云，语义检索不出本机 | 推荐默认姿势 |

---

## 5 分钟最小可用配置

```bash
cp apps/server/.env.example apps/server/.env
```

编辑 `apps/server/.env`，只改三行：

```ini
AI_BASE_URL=https://api.deepseek.com/v1   # 你选的厂商端点
AI_API_KEY=sk-你的key                      # 你自己的 Key
AI_MODEL=deepseek-chat                     # 你开通的模型名
```

启动：

```bash
pnpm install && pnpm dev        # 或 node apps/server/dist/apps/server/src/cli.js health
```

**验收**：浏览器开 `http://localhost:3000/api/docs`，`/api/health` 返回 200 即通。若 `settings/check` 返回 503，九成是 Key 填错或模型名不存在——先别看代码，去厂商控制台核对模型名（DeepSeek 叫 `deepseek-chat`，豆包叫 `doubao-seed-*`，名字对不上一切白搭）。

### 一条新手最容易踩的坑

`.env` 必须放在 `apps/server/` 下（不是仓库根目录）。从根目录启动时它也会被显式加载，但放错了位置你会对着「配置明明写了却不生效」耗半小时——别问是怎么知道的。

---

## 模型路由：fast / strong 双档

SciFlow 把 LLM 调用分成两档，**分别计费**：

```ini
AI_MODEL_FAST=deepseek-chat          # 对话、翻译、意图识别等高频轻活
AI_MODEL_STRONG=deepseek-reasoner    # 章节起草、评审、规划等深活
```

不配就都走 `AI_MODEL`。**建议必配**：流水线一轮 8 章节起草 × 3 轮质量门，全用强模型的话账单会教你做人；评审/起草用 reasoner 级、润色/翻译用 chat 级，总成本能压一半以上。

每次调用的真实消耗都记录在 `llm_call_log` 表——设置页 Usage 面板能看到每次调用的 token 数，月底对账不用猜。

> 本地推理路线：`AI_BASE_URL=http://127.0.0.1:11434/v1`（Ollama），模型名填 `qwen2.5:14b` 之类。嵌入模型同理走本地，见下一节。

---

## 嵌入模型：可选，且永远可选

语义检索（向量 ANN）需要嵌入模型。**SciFlow 不内置、不自动下载**——这是刻意的：50MB 的模型文件自动落盘这种事，在没打招呼的情况下发生就不体面。

两种姿势：

```ini
# 姿势 A：自备 GGUF（推荐 bge-small-zh-v1.5 q4_k_m，384 维）
EMBEDDING_MODEL_PATH=/home/you/models/bge-small-zh-v1.5-q4_k_m.gguf

# 姿势 B：什么都不配
# 向量检索自动降级为 FTS5 BM25 → LIKE 全文检索，功能不阻塞
```

没配嵌入模型时，搜索照常能用（BM25 对中英混合查询效果尚可），只是语义相近但字面不同的内容召回会弱一些。**先用起来，觉得检索不够聪明再回来配**。

注意：vec0 虚拟表固定 384 维（对应 bge-small 系），换 768 维模型请先看 `docs/master-plan.md` 的维度迁移计划——现在会静默降级，不会崩。

---

## 联网搜索：开源内置，闭源自填

搜索是可插拔的。**开源路线零成本，商业路线你自己填 Key**，SciFlow 不代管、不抽成：

```bash
# SearXNG（推荐）：自部署开源元搜索，隐私友好，可聚合多引擎
docker run -d -p 8888:8080 searxng/searxng
# 然后 PUT /api/web/config: { "provider": "searxng", "searxngUrl": "http://127.0.0.1:8888" }

# 商业引擎（可选）：Tavily / Serper / Brave，Key 你自己去申请
# PUT /api/web/config: { "provider": "tavily", "tavilyKey": "tvly-xxx" }
```

什么都不配时默认走 DuckDuckGo 兜底（免 Key，通用摘要级质量）。

**科研问答里要不要联网**？默认关（`websearch_in_chat=on` 开启）。开了之后：知识库无命中时才发起网搜，来源以 `[网搜N]` 标注进上下文、以 🌐 卡片展示给前端。文献事实类问题建议关着——模型引用网页比幻觉引用更隐蔽，而 SciFlow 的立场是引用必须可溯源。

查看当前配置（Key 掩码回显）：

```bash
curl http://127.0.0.1:3000/api/web/config
```

---

## 安全姿势：什么时候必须开认证

默认零登录（`AUTH_MODE=none`），服务只监听 `127.0.0.1`——单机使用，这是最省心的姿势。

**两种情况必须改**：

1. 监听到局域网（`HOST=0.0.0.0`，比如给同组人共用）→ 必须 `AUTH_MODE=jwt` + `JWT_SECRET`，否则**启动闸直接拒绝拉起**。这不是建议，是硬约束。
2. 暴露公网 → 在 1 的基础上加反向代理 + HTTPS，并把 `SANDBOX_TIMEOUT_MS` 想清楚（Python 沙箱是进程级隔离，不是容器级——威胁模型写在 `experiments.service.ts` 注释里，读一遍再决定要不要对外开放执行面）。

```ini
AUTH_MODE=jwt
JWT_SECRET=openssl rand -hex 32 的输出贴这里
HOST=0.0.0.0
```

首个注册用户自动成为管理员。数据库里的厂商 API Key 全程 AES-256-GCM 加密（主密钥 `apps/server/data/.sciflow.key`）——**备份 sciflow.db 时把 key 文件当成跟密码同级的资产对待，两者永远别放同一个压缩包里传网盘**。

---

## Docker 一把梭

```bash
docker compose up -d          # dev 配置
docker compose -f docker-compose.prod.yml up -d   # 生产配置
```

镜像构建走 `Dockerfile`（glibc 基础镜像——别手贱换 alpine/musl，better-sqlite3 的原生模块会教做人，v0.4.2 修过三处相关真因）。健康检查打 `/api/health`，114 条路由全注册即构建正确。

---

## 速查：所有可调项

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 无 | 三件套，缺一不可（零内置原则） |
| `AI_MODEL_FAST` / `AI_MODEL_STRONG` | 同 `AI_MODEL` | 双档路由，强烈建议分开 |
| `AI_RPM_CAP` | 8 | 每分钟 AI 调用上限（令牌桶），防 429 风暴 |
| `EMBEDDING_MODEL_PATH` | 无 | 自备 GGUF 嵌入模型路径，不配则全文检索 |
| `SCIFLOW_MODEL_CACHE` | `~/.sciflow/models` | 模型缓存目录 |
| `WEBSEARCH_PROVIDER` | duckduckgo | searxng / tavily / serper / brave |
| `WEBSEARCH_IN_CHAT` | off | chat 联网兜底开关 |
| `AUTH_MODE` / `JWT_SECRET` | none / 无 | 认证模式（非回环监听强制 jwt） |
| `HOST` | 127.0.0.1 | 监听地址（0.0.0.0 触发安全闸） |
| `SANDBOX_TIMEOUT_MS` | 10000 | Python 沙箱单次执行超时 |
| `DATABASE_PATH` | `apps/server/data/sciflow.db` | SQLite 路径 |
| `AI_MOCK` | 0 | 1 = 进程内 mock 网关（CI / 无网环境） |

环境变量是首层兜底；运行期在设置页改的（厂商切换、搜索 provider）落 `app_setting` 表，**运行期配置优先于环境变量**——调试「改了没生效」时先看设置页。

---

## CLI headless 全流程（一条命令出论文）

后端已启动时，CLI 可无人值守跑完整流水线：

```bash
node apps/server/dist/cli.js run --topic "图神经网络在生物医药中的应用" --auto --depth 2 --out ./paper/
#   --auto      自动确认大纲（不加则在大纲确认点停下，exit 2）
#   --depth 1-3 研究深度：文献调研按轮递归检索（更全，token 消耗更高）
#   --out 目录  完成后把论文 Markdown 写入 ./paper/<论文标题>.md
```

研究深度也可以在「流水线页 / 工作台」用深度选择器切换（标准 / 深入 / 彻底），两者写同一个全局设置。

## 排障三连

1. **AI 调用全 429** → 看 `AI_RPM_CAP`，免费档模型把数值调小；流水线并发起草天然是突发流量。
2. **检索结果全是「知识库中没有找到」** → 知识库空？文档上传成功但嵌入模型没配（去日志找「未找到本地嵌入模型」警告）？命中与否在知识库页直接搜一下就分清。
3. **引用渲染出来是 `[文献N]`** → 这是引用池外的降级标记，属预期行为：作者没在文献库命中里被正文引用。把该文献加入项目文献库即可转正为编号引用。
