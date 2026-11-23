# 验收报告 · 1.19.17

**简体中文** · [English](ACCEPTANCE-REPORT.md)

最后执行：**2026-11-24 02:38–02:45（CST）** · 受测版本：**1.19.17** ·
代码基线：`8eac623` 加上本报告列出的 1.19.17 工作区改动。

这份报告收口三张一直未闭环的验收票：

1. 真实第三方连接器，必须发生真实调用，不能用 mock 冒充成功；
2. 完整浏览器用户旅程：上传扫描件 → 真实模型回答 → 落成文档 → 导出 PDF → 分享 → 评论 → 审核；
3. 协作边界、1 万条搜索 P95、PWA 旧缓存与真实 token 计量。

报告只写实际观察到的事实：通过的写通过，被外部凭据卡住的写 blocked，没做的写没做。

## 完成状态

| 项目 | 结论 | 实际证据 |
| --- | --- | --- |
| Zotero 真实连接器 | **已做完 / PASS** | 公开库 `475425` 免 Key 连接；测试返回“库内 164 条”；导入 `fetched=10, added=7, duplicate=1, skipped=2` |
| 飞书真实群消息 | **已做完 / PASS** | 用户身份向验收群 `oc_372a49ef1a17564e6bef107893e8e1cb` 发出真实消息 `om_x100b7f76383a60a115bcafb08d9eb24` |
| 飞书自定义机器人 Webhook | **未闭环 / BLOCKED** | 环境里没有真实群 Webhook URL；HTTPS 白名单与错误解析有单测，但没有真实 POST |
| 飞书应用连接器 | **未闭环 / BLOCKED** | 没有真实 App ID / App Secret；假凭据返回 `tenant_access_token` 错误 `10003`，只能证明确实发起了真实换 token |
| 浏览器全旅程 | **已做完 / PASS** | 在最终构建 `18:37:54` 上跑 F 轮：扫描件上传 → 回答 `3200 W/(m·K)` → 干净文档 `4f1d9c7f...` → PDF → 公开分享 → 匿名评论 → 作者删除 → 撤销 |
| 跨项目会话 guard | **已做完 / PASS** | 外来项目的 `?session=` 明确报错，不再静默新建对话 |
| 协作边界 | **已做完 / PASS** | 权限矩阵、快照字段、评论默认关闭与软删除均与文档一致 |
| 1 万条搜索 P95 | **已做完 / PASS** | 新灌 1 万条：service 文档 P95 **1.26 ms**，全类型 P95 **3.90 ms**，HTTP 文档 P95 **4.44 ms** |
| PWA 旧缓存 | **已做完（桌面 Chromium）/ PASS** | 新 Service Worker 清掉注入的 legacy 缓存；离线壳显示重连页 |
| 真实 token 计量 | **已做完 / PASS** | API 与 SQLite 交叉一致；单次执行与同窗口 LLM 调用均为 **8,158** tokens |
| 确定性门禁 | **已做完 / PASS** | 949 server + 276 web + 5 desktop 通过，1 skipped；lint、typecheck、双端 build、chunk budget 全过 |

## 1. 真实第三方链路

### 环境

- 验收库：`/tmp/sciflow-accept/sciflow.db`，用 SQLite `backup()` 从
  `/home/user/.sciflow/sciflow-final-e2e.db` 在线复制，并复制同一份 `.sciflow.key`。
- 服务：端口 `4404`，隔离库，关闭鉴权。
- 模型：`https://api.qs.al/v1`、`deepseek-v4.1-flash`，`/api/health` 明确返回
  `mock=false`。

### Zotero

连接通过公开 API 写入，不是直接改数据库：

```json
POST /api/connectors/connect
{"projectId":"e1139d37-e06c-4b9a-baa2-c11ccc7f842a",
 "key":"zotero",
 "config":{"libraryId":"475425","libraryType":"user","apiKey":""}}
```

`POST /api/connectors/test` 返回 `Zotero 连接正常，库内 164 条`。
`POST /api/connectors/zotero/import` 返回：

```json
{"fetched":10,"added":7,"duplicate":1,"skipped":2}
```

连接器列表显示 `connected=true`、脱敏后的库 ID、导入摘要，`checkedAt=1795456147964`。
这是真实访问 Zotero 公开 Web API，并真实写入本地文献表。

### 飞书

这里有三条不同链路，不能混为一谈：

- **消息送达：** 通过飞书用户身份向私有验收群
  `oc_372a49ef1a17564e6bef107893e8e1cb` 发出真实文本消息，消息 ID
  `om_x100b7f76383a60a115bcafb08d9eb24`，内容明确写明这是真实链路验收、不是 mock。
- **连接器应用模式：** 服务确实发起了 `tenant_access_token` 交换。用故意伪造的凭据
  返回 `code: 10003, msg: invalid param`，证明代码走到了真实换 token，而不是只 import
  SDK；但没有真实 App 凭据，成功送达仍未验证。
- **连接器 Webhook 模式：** 代码支持自定义机器人 Webhook，发送前强制 HTTPS 和
  `open.feishu.cn` / `open.larksuite.com` 白名单，并解析 `code` / `StatusCode`。单测覆盖
  `http://127.0.0.1:9999/hook` 在发请求前被拒绝。实际拿不到 URL：飞书 OpenAPI/CLI 没有
  创建自定义机器人的入口；在 base `I67XbMspcaAsEss074zc0Bxr6o7` 上试 Bitable 外部
  Webhook 触发器返回 `800005667 webhook not available`；浏览器登录停在扫码页，
  接管请求被跳过。

**边界：** 飞书群消息是真实的，但发送者是用户身份，不是 SciFlow 连接器。连接器的
Webhook 与应用模式成功路径在本环境仍未打通，报告不写成通过。

### 国内优先后的连接器范围

`ConnectorKey` 现在只有 `zotero | feishu`。Notion、Google Drive、Overleaf 是直接移除，
没有留下“待凭据”的假入口：

- 目录项、`check()` 分支、`notionSearch()`、`driveList()` 删除；
- `/connectors/notion/search`、`/connectors/drive/list` 删除；
- `@notionhq/client`、`googleapis` 从 `apps/server/package.json` 与 lockfile 删除；
- OpenAPI 重新生成后为 **268** 条 path，Notion/Drive schema 与 `ProjectBody` 组件消失；
- 设置页只剩两个连接器。

Zotero 暂时保留为用户自带的文献数据源：用户填库 ID 和可选 Key，数据落到本地 SQLite，
不是 SciFlow 托管账号。如果“国内优先”要连 Zotero 也删，这应是一次明确的产品决策，
不能在这次发版里偷偷改掉。

## 2. 完整浏览器旅程

在重建后的验收库与最终生产 Web 构建（`2026-11-23T18:37:54.791Z`）上执行，使用
Playwright 驱动的 headless Chromium 146。C/D/E 三轮是迭代过程，下面只记录 F 轮的最终证据；
每轮都真实调用模型、落库和渲染，没有用静态页面或 mock 代替。

| 步骤 | 实际观察 |
| --- | --- |
| 项目 | `e1139d37-e06c-4b9a-baa2-c11ccc7f842a`（真实模型终验 · GNN 分布外泛化） |
| 上传 | `/tmp/scan.pdf`，一页纯图片扫描件，内容为合成的材料测试报告 |
| 提问 | “请读取这份扫描件里的热导率数值，保留单位，并说明它来自哪份材料。” |
| 回答 | “扫描件中报告的热导率数值为 3200 W/(m·K)，测试方法为激光闪射法。” |
| 保存文档 | `4f1d9c7f-caa6-4249-9783-0cf6638d089f`，标题“扫描件热导率复验 F · 20261124”，正文 659 字，数据库复查不含内部标记 |
| 导出 | `acceptance-2026-11-24-export.pdf`，367,596 字节；PDF Title 与文档标题一致；文本层含 `3200 W/(m·K)`，不含 `---FOLLOWUPS---`；创建时间 `2026-11-24 02:40:57 +08` |
| 分享 | `http://127.0.0.1:4404/share/c912578cf187e69b8332ed6f6507fbe311410340ccef9feb`；新建时评论开关默认关闭，勾选后才允许评论 |
| 公开阅读 | 标题与正文渲染出保存时的快照，含 3200 |
| 匿名评论 | “1.19.17 最终构建浏览器全旅程：扫描件→对话→干净文档→PDF→分享评论，2026-11-24。”，署名“验收读者 Final F” |
| 作者审核 | 分享弹窗显示“读者评论 · 1”；点“删除评论”后显示“还没有评论。”，公开 API 返回空列表 |
| 撤销 | 点“撤销链接”后刷新公开页，显示“分享链接已撤销” |

扫描件是验收素材，不是真实科学测量。3200 不能被引用为材料属性。这里验证的是链路：
图片 OCR → 真实模型调用 → 落文档 → PDF 渲染 → 不可变分享快照 → 匿名评论 → 作者审核。

证据：

- [真实回答](verification/assets/acceptance-2026-11-24-chat.png)
- [写作页与 PDF 导出](verification/assets/acceptance-2026-11-24-export.png)
- [公开页与匿名评论](verification/assets/acceptance-2026-11-24-public-comment.png)
- [作者看到评论](verification/assets/acceptance-2026-11-24-author-comment.png)
- [删除评论后](verification/assets/acceptance-2026-11-24-comment-hidden.png)
- [撤销后](verification/assets/acceptance-2026-11-24-revoked.png)
- [新分享评论默认关闭](verification/assets/acceptance-2026-11-24-share-default-off.png)
- [导出的 PDF](verification/assets/acceptance-2026-11-24-export.pdf)
- [扫描件样本](verification/assets/acceptance-2026-11-24-scan.pdf)

### 旅程中发现并修掉的缺陷

**跨项目会话静默回落。** 会话 `0ba3ed72-cc87-4671-b3bb-2f0b37ff306a` 属于
`e1139d37`，但当前项目是 `7fb3c5a9` 时，带 `?session=` 打开工作台不报错；它静默新建
“新对话”，把附件传到错误项目，还把文档落到 `7fb3c5a9`。现在工作台在
`serverSessionsQuery.data` 已返回、但列表里没有该会话时，设置 `focusSessionConsumed`，
显示“该会话不属于当前项目，已阻止打开；请切换到会话所属项目后重试。”，不再调用跨项目详情
接口。另有回归单测覆盖。

- [正确项目可看到 guard 会话](verification/assets/acceptance-2026-11-24-guard-good.png)
- [错误项目明确拒绝](verification/assets/acceptance-2026-11-24-guard-foreign.png)

**分享弹窗缺作者审核入口。** 第一版只能生成链接，作者看不到评论，也无法删除，和 A7
要求不符。现在弹窗读取 `targetId`，按 `targetType + targetId` 找到已有分享，显示
“读者评论 · N”，每条右侧有删除按钮。服务层是软删除（`status='hidden'`），审计行保留；
UI 文案是“删除评论”。

**保存回答把内部标记写进成稿。** D 轮导出后发现文档正文尾部出现 `---FOLLOWUPS---` 与追问草稿。原因是“保存为文档”直接落 `message.content`，而流式回答的追问约定也在同一个字符串里。现在落稿统一走 `parseFollowUps(message.content).content.trim()`，正文与追问分离；F 轮数据库复查 `instr(content, "---FOLLOWUPS---") = 0`，PDF 文本层同样为 0。刷新历史会话时，旧数据里的标记也会在渲染层剥离，不再出现在气泡里。

**分享弹窗的评论开关可能串台。** `openShare` 只对“已有分享”设置开关值；如果先看一个开过评论的分享，关闭后再打开一个没有分享的文档，checkbox 可能残留为 true。现在每次打开先重置为 false，只有查到 existing 分享且其允许评论时才置 true；并发请求用 `shareLookupSeq` 丢弃晚到的旧结果。F 轮在全新文档上实测默认关闭，单测覆盖回归。

**深链与底部 Tab 不一致。** `#/write-review?doc=...&tab=citations` 首次渲染不会自动切到
“引用与导出”，仍需手点一次。这是小的深链一致性缺陷，不阻塞本次发版，但记录在案。

## 3. 协作边界

以 [`COLLABORATION-BOUNDARY.zh-CN.md`](COLLABORATION-BOUNDARY.zh-CN.md) 为准，实测行为
与文档一致：

- 项目只有一个所有者，没有成员模型、组织账号或共享项目库；
- 分享是单篇文档或单段会话的冻结快照；
- 文档快照只含标题、Markdown 正文、版本、更新时间、项目名；对话快照只含可见的
  user/assistant 正文，最多 200 条、每条 50,000 字符；
- 附件、文件名、推理过程、工具调用与结果、系统提示、消息 ID、token 用量、模型名
  都不进入对话快照；
- 评论默认关闭、匿名、纯文本，2–1,000 字符，署名可空且最多 40 字符；
- 作者可隐藏评论、撤销链接或让其到期；
- 没有回复、提及、表情、通知、审核队列或读者分析。

文档已改成“隐藏 = 软删除”，并注明 UI 实际按钮叫“删除评论”，避免把“删除”误解为物理
删行。

## 4. 1 万条搜索 P95

新建 `/tmp/sciflow-perf2/sciflow.db`，灌入 1 个项目与 **10,000** 篇文档，统一查询词。
没有使用生产数据，也没有复用此前 `/tmp/sciflow-perf` 的旧数。

| 测量 | 样本 | P50 | P95 | 最大 |
| --- | --- | --- | --- | --- |
| `SearchService.search(project, query, 'document')` | 100 | 0.60 ms | **1.26 ms** | 3.50 ms |
| `SearchService.search(project, query)`（六类全查） | 100 | 1.43 ms | **3.90 ms** | 5.31 ms |
| `GET /api/search?...&types=document` | 50 | 2.71 ms | **4.44 ms** | 23.91 ms |

HTTP 首轮撞上全局限流 `429`，丢弃后等冷却，再顺序测 50 次。这是种子文本压测，不代表
任意生产语料。

## 5. PWA 缓存与离线壳

生产构建事实：

- build ID `2026-11-23T18:37:54.791Z`，注入 `meta[name=sciflow-build]` 与
  `window.__SCIFLOW_BUILD__`；
- `dist/sw.js` 由 `vite-plugin-pwa` 生成，`generateSW`、
  `navigateFallback: index.html`、`navigateFallbackDenylist: [/^\/api\//]`、
  `cleanupOutdatedCaches: true`；
- 当前缓存名 `workbox-precache-v2-http://127.0.0.1:4404/`；
- 168 条 precache，8,706.62 KiB。

在最终构建上做的持久化 Chromium 实测（先把 `dist/sw.js` 改成内容不同的旧版本、装好后恢复最终 `sw.js`，让浏览器真实走一次 update/activate）：

1. 页面注册 `http://127.0.0.1:4404/sw.js`，暴露上述 build ID；
2. 注入 legacy 缓存
   `workbox-precache-v2-http://127.0.0.1:4404/legacy-old`；
3. 部署新 Service Worker 并调用 `registration.update()`；
4. 刷新后只剩 `workbox-precache-v2-http://127.0.0.1:4404/`，legacy 被
   `cleanupOutdatedCaches` 删除；
5. 切换离线后重载，应用壳显示
   “当前离线，或连不上后端 / SciFlow 的应用壳已由 Service Worker 缓存，离线也能打开；科研数据与 AI 能力需要连回后端。”，并带“重新连接”按钮，没有停在启动 Spinner。

- [离线壳](verification/assets/acceptance-2026-11-24-pwa-offline.png)

**边界：** 这里证明的是桌面 Chromium 的注册、版本更新、旧缓存清理与离线导航；没有在
真实 iOS / Android 手机上验证安装提示和更新。该项写“未做”，不写“通过”。

## 6. 真实 token 计量

2026-11-24 02:05 快照，项目 `e1139d37...`，
`GET /api/agent/metrics?days=7&projectId=...`：

| 指标 | 数值 |
| --- | --- |
| 运行 | 28 total，26 done，0 error，0 running |
| 平均耗时 | 94,377 ms |
| 总 token | **357,524** |
| 工具调用 | 82 total，82 ok，0 fail，100% success |
| 工具延迟 | 平均 347 ms，P95 8 ms |
| 按天 | 2026-11-22：82 calls / 0 fail / 336,916 tokens；2026-11-23：0 calls / 20,608 tokens |

同库 SQLite 交叉：

- `agent_execution` 36 行，`sum(total_tokens)=396,005`；
- `llm_call_log` 170 行，`sum(total_tokens)=1,051,854`。

两组数不同有明确原因：API 是“最近 7 天 + 单项目”，SQL 是全项目、全 caller，包含意图
分类、会话摘要、写作辅助。不是计量不一致。

抽一次干净执行做同窗口对齐：

- `agent_execution` id `34f4a925-7c60-4a7d-bef7-83f048a0ee48`，项目 `e1139d37...`，
  `created_at=1795456749450`，`duration_ms=4,710`，`total_tokens=8,158`；
- 同一 start→end 窗口的 `llm_call_log` 恰好 **1** 条，caller `chatWriting`，model
  `deepseek-v4.1-flash`，`total_tokens=8,158`。

这是同一窗口的逐项相等，不是估算。

## 7. 确定性门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm -r test` | server 138 文件 / 949 passed / 1 skipped；web 51 文件 / 276 passed；desktop 1 文件 / 5 passed；exit 0 |
| `pnpm lint` | exit 0 |
| Web typecheck | exit 0 |
| Server build | exit 0 |
| Web build | exit 0，PWA 168 precache / 8,706.62 KiB |
| OpenAPI 生成 | 268 paths，`targetId` 已进入 schema 与生成类型 |
| Chunk budget | 首屏 437.3 KB raw / 132.3 KB gzip；最大懒加载块 1,463.8 KB raw / 447.9 KB gzip，首屏不加载；exit 0 |

`pnpm openapi:check` 是干净工作区检查（`git diff --exit-code`），必须在发布提交之后跑；
提交前跑会报“有意未提交的 OpenAPI diff”。生成本身已成功。

## 8. 仍未闭环

以下项目没有被偷偷写成完成：

1. **飞书自定义机器人 Webhook** 需要真实群 Webhook URL；没有它，只验证了 HTTPS 守卫与
   错误解析。
2. **飞书应用连接器** 需要真实 App ID / App Secret；假凭据只能证明确实发起了换 token。
3. **手机 PWA 安装与更新** 没有在真实 iOS / Android 设备上跑；桌面 Chromium 的注册、
   更新、离线壳已通过。
4. **Zotero 去留** 是产品决策。1.19.17 保留为用户自带的文献 API；若“国内优先”要求连它
   也删，应单独跟进，不能靠猜。
5. **深链 Tab**（`tab=citations`）仍需手点一次“引用与导出”。

## 9. 复现要点

- 服务：在 `apps/server` 下
  `PORT=4404 DATABASE_PATH=/tmp/sciflow-accept/sciflow.db LOCAL_WHISPER_MODEL=/home/user/models/whisper-small-zh node dist/apps/server/src/main.js`。
- 验收库：用 SQLite `backup()`，不要只 `cp` 主文件；漏 WAL 会得到空项目列表。
- 浏览器：Playwright Chromium
  `/opt/vm/preinstall/ms-playwright/chromium-1169/chrome-linux/chrome`。
- 分享裸路径是 `/share/<token>`，`#/share/<token>` 打不开。
- 写作页要先手点“引用与导出”，再点“导出 PDF”。

本报告里的截图与 PDF 都复制在 `docs/verification/assets/`，不依赖外部图床。
