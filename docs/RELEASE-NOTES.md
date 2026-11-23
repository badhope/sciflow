# SciFlow 1.19.17

三张验收票在最终构建上收口：真实第三方调用、完整浏览器旅程、协作边界 / 1 万条搜索 P95 / PWA 旧缓存 / 真实 token。

## 已做完

- **浏览器全旅程**：扫描件上传 → 真实模型回答（3200 W/(m·K)）→ 保存为干净文档 `4f1d9c7f...` → 导出 PDF（367,596 字节）→ 新建公开分享（评论默认关闭）→ 匿名评论 → 作者删除（软删除）→ 撤销链接。
- **跨项目会话 guard**：错误项目打开外来 `?session=` 会明确阻止，不再静默新建对话或写错项目。
- **协作边界**：权限矩阵、快照字段、评论默认关闭与 `status='hidden'` 软删除一致；作者可在弹窗内审核评论。
- **1 万条搜索 P95**：service 文档 1.26 ms / 全类型 3.90 ms / HTTP 文档 4.44 ms。
- **PWA 旧缓存**：最终构建上注入 legacy 缓存后执行真实 update/activate，旧缓存被 `cleanupOutdatedCaches` 删除；离线显示重连壳。
- **真实 token**：单次执行与同窗口 `llm_call_log` 均为 8,158 tokens，API 与 SQLite 交叉一致。
- **Zotero**：公开库 `475425` 免 Key 真实连接，返回“库内 164 条”，导入 `fetched=10 / added=7 / duplicate=1 / skipped=2`。

## 修复

- 知识库内联 `type=text` 上传不再被 `.pdf` 等扩展名劫持进二进制解析器；`forceKind='text'` 固定调用方声明的纯文本语义。
- “保存为文档”不再把 `---FOLLOWUPS---` 与追问草稿写进正文；历史会话打开时统一剥离内部标记。
- 分享评论开关不再沿用上一个目标；按 `targetType + targetId` 命中后才恢复。
- 飞书 Webhook 不再把 HTTP 200 一律当成功，JSON `code` / `StatusCode` 非 0 会降级为站内失败通知。
- CI 干净安装补齐 `@nestjs/event-emitter`、`ffprobe-static`、`croner`，并安装 `ffmpeg`；`protobufjs` 的 `allowBuilds` 占位值改为布尔值。
- `scripts/full_regression.py` 对齐 B6：`project.templates` 改为负向断言，不再要求已删除字段回显。

## 门禁

- CI `Types / Unit / Build`、`E2E + prompt evals`、`Full mock regression` 三 job 全绿。
- 本地 `pnpm -r test`：server 951 passed / 1 skipped，web 276 passed，desktop 5 passed。
- `full_regression.py`：222 PASS / 0 FAIL。
- 最终 web build `2026-11-23T18:37:54.791Z`，PWA 168 条 precache / 8,706.62 KiB。

## 边界

- 飞书自定义机器人 Webhook 仍缺真实群 URL；应用模式仍缺真实 App ID / App Secret。报告明确标注 blocked，不用 mock 冒充成功。
- PWA 安装与更新已在桌面 Chromium 验证，未上真实 iOS / Android。
